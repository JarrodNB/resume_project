"""Exercise isolated import output and source ownership with offline providers."""

from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel


def test_single_chunk_selects_record_types_and_restores_exact_sources(offline_model_resolution):
    from resume_import import import_resume_text

    async def answer(messages, info):
        prompt = messages[-1].parts[-1].content
        assert "[S3] • Built tools" in prompt
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {"type": "skill", "source_id": "S6", "fields": {"name": "Python"}},
                            {
                                "type": "experience",
                                "source_id": "S2",
                                "fields": {
                                    "company": "Acme",
                                    "title": "Engineer",
                                    "highlight_ids": ["S3"],
                                },
                            },
                        ],
                        "unassigned_highlights": [{"source_id": "S4", "reason": "missing_role"}],
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = import_resume_text(
        "Experience\nAcme | Engineer\n• Built tools\n  with care.\n• Shared work\n\nSkills\nPython",
        "openai:gpt-5-mini",
        "low",
        5,
        "openai:gpt-5-nano",
    )
    assert result.parsed_resume.experiences[0].highlights == ["Built tools\nwith care."]
    assert result.parsed_resume.unassigned_highlights[0].text == "Shared work"
    assert (
        result.parsed_resume.unassigned_highlights[0].source_context
        == "Experience\nAcme | Engineer"
    )
    assert result.parsed_resume.skills[0].name == "Python"


def run_import():
    from resume_import import import_resume_text

    return import_resume_text(
        "Experience\nAcme\n• Same text\n• Same text",
        "openai:gpt-5-mini",
        "low",
        5,
        "openai:gpt-5-nano",
    )


def test_invalid_ownership_retries_without_returning_partial_result(offline_model_resolution):
    import pytest
    from pydantic_ai.exceptions import UnexpectedModelBehavior
    from pydantic_ai.usage import RequestUsage

    from worker.task_usage import collect_task_usage

    calls = []

    async def answer(messages, info):
        calls.append(True)
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {
                                "type": "experience",
                                "source_id": "S2",
                                "fields": {
                                    "company": "Acme",
                                    "title": "Engineer",
                                    "highlight_ids": ["S3"],
                                },
                            }
                        ],
                        "unassigned_highlights": [{"source_id": "S3", "reason": "ambiguous_role"}],
                    },
                )
            ],
            usage=RequestUsage(input_tokens=10, output_tokens=2),
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with collect_task_usage() as usage, pytest.raises(UnexpectedModelBehavior):
        run_import()
    assert len(calls) == 3
    assert sum(entry.input_tokens for entry in usage.entries) == 30


def test_repeated_text_has_distinct_occurrence_ids_and_source_order(offline_model_resolution):
    async def answer(messages, info):
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {
                                "type": "experience",
                                "source_id": "S2",
                                "fields": {
                                    "company": "Acme",
                                    "title": "Engineer",
                                    "highlight_ids": ["S4", "S3"],
                                },
                            }
                        ],
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    assert run_import().parsed_resume.experiences[0].highlights == ["Same text", "Same text"]


def test_complete_source_screened_once_and_bound_prompt_reuses_approval(
    monkeypatch, offline_model_resolution
):
    from pydantic_ai.usage import RunUsage

    from agents.user_text_screen_agent import UserTextScreenRun
    from schemas.user_text_screen import UserTextScreen

    screened = []

    async def screen(text, *args):
        screened.append(text)
        return UserTextScreenRun(
            UserTextScreen(prompt_injection=False, harmful_request=False),
            "jev-1.13.0",
            {"prompt_injection": 1.0, "harmful_request": 1.0},
            RunUsage(),
        )

    async def answer(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])

    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", screen)
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    run_import()
    assert screened == ["Experience\nAcme\n• Same text\n• Same text"]


def test_blocked_input_never_reaches_extractor(monkeypatch, offline_model_resolution):
    import pytest
    from pydantic_ai.usage import RunUsage
    from pydantic_ai_harness import InputBlocked

    from agents.user_text_screen_agent import UserTextScreenRun
    from schemas.user_text_screen import UserTextScreen

    async def screen(*args):
        return UserTextScreenRun(
            UserTextScreen(prompt_injection=True, harmful_request=False),
            "jev-1.13.0",
            {"prompt_injection": 1.0, "harmful_request": 1.0},
            RunUsage(),
        )

    async def answer(*args):
        raise AssertionError("blocked input reached extractor")

    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", screen)
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(InputBlocked):
        run_import()


def test_deadline_cancels_provider_and_retains_unknown_usage(offline_model_resolution):
    import asyncio

    import pytest

    from resume_import import import_resume_text
    from worker.task_usage import collect_task_usage

    cancelled = []

    async def answer(messages, info):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with collect_task_usage() as usage, pytest.raises(TimeoutError):
        import_resume_text(
            "Experience\nAcme\n• Work", "openai:gpt-5-mini", "low", 0.2, "openai:gpt-5-nano"
        )
    assert cancelled == [True]
    assert usage.incomplete


def test_request_cap_applies_to_extraction_retries_not_screening(
    monkeypatch, offline_model_resolution
):
    import pytest
    from pydantic_ai.exceptions import UsageLimitExceeded
    from pydantic_ai.usage import UsageLimits

    calls = []

    async def answer(messages, info):
        calls.append(True)
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "unassigned_highlights": [
                            {"source_id": "foreign", "reason": "missing_role"}
                        ],
                    },
                )
            ]
        )

    monkeypatch.setattr(
        "resume_import.agent_usage_limits", lambda settings: UsageLimits(request_limit=1)
    )
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UsageLimitExceeded):
        run_import()
    assert calls == [True]


def test_unknown_nested_fields_are_rejected_at_extraction_interface(offline_model_resolution):
    import pytest
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    async def answer(messages, info):
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {
                                "type": "skill",
                                "source_id": "S1",
                                "fields": {"name": "Python", "invented_field": "ignored?"},
                            }
                        ],
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UnexpectedModelBehavior):
        run_import()


def test_synthetic_evaluation_dataset_and_expected_labels():
    from types import SimpleNamespace

    from evals.resume_import_evaluators import UnassignedPlacement
    from evals.run_resume_import_evals import load_resume_import_dataset

    dataset = load_resume_import_dataset()
    assert len(dataset.cases) == 3
    for case in dataset.cases:
        context = SimpleNamespace(expected_output=case.expected_output, output=case.expected_output)
        assert set(UnassignedPlacement().evaluate(context).values()) == {1.0}


def test_fallback_prices_answering_model_and_keeps_failed_request_unknown(offline_model_resolution):
    from pydantic_ai.exceptions import ModelHTTPError
    from pydantic_ai.usage import RequestUsage

    from worker.task_usage import collect_task_usage

    async def broken(messages, info):
        raise ModelHTTPError(503, "gpt-5-mini", "temporary provider outage")

    async def answer(messages, info):
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=11, output_tokens=3),
            model_name="openai:gpt-5-nano",
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(broken))
    offline_model_resolution(
        "openai:gpt-5-nano", FunctionModel(answer, model_name="openai:gpt-5-nano")
    )
    with collect_task_usage() as usage:
        result = run_import()
    assert result.model == "openai:gpt-5-nano"
    assert result.model_usages[0].input_tokens == 11
    assert usage.incomplete
    assert usage.entries[0].model == "openai:gpt-5-nano"


def test_unknown_record_kind_and_nonbullet_highlight_are_rejected(offline_model_resolution):
    import pytest
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    for record in [
        {"type": "unknown", "source_id": "S1", "fields": {}},
        {
            "type": "experience",
            "source_id": "S2",
            "fields": {"company": "Acme", "title": "Engineer", "highlight_ids": ["S2"]},
        },
    ]:

        async def answer(messages, info, record=record):
            return ModelResponse(
                parts=[ToolCallPart(info.output_tools[0].name, {"records": [record]})]
            )

        offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
        with pytest.raises(UnexpectedModelBehavior):
            run_import()


def test_masked_source_and_unassigned_output_restore_within_privacy_scope(offline_model_resolution):
    import re

    from resume_import import import_resume_text
    from worker.contact_mask import import_privacy_scope, install_contact_hooks

    install_contact_hooks()

    async def answer(messages, info):
        prompt = messages[-1].parts[-1].content
        assert "jane@example.test" not in prompt
        assert re.search(r"«pii:[^»]+»", prompt)
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "unassigned_highlights": [{"source_id": "S2", "reason": "missing_role"}],
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with import_privacy_scope() as privacy:
        masked = privacy.prepare(
            "Contact jane@example.test\n• Contact jane@example.test for details."
        )
        result = import_resume_text(masked, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano")
        restored = privacy.restore(result.parsed_resume)
    assert restored.unassigned_highlights[0].text == "Contact jane@example.test for details."
    assert restored.unassigned_highlights[0].source_context == "Contact jane@example.test"


def test_unindented_uppercase_wrapping_and_context_across_blank_lines(offline_model_resolution):
    from resume_import import import_resume_text

    async def answer(messages, info):
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "unassigned_highlights": [{"source_id": "S3", "reason": "ambiguous_role"}],
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = import_resume_text(
        "EXPERIENCE\nAcme | Engineer\n\n• Built services using\nPython and PostgreSQL.\n\nSKILLS\n• Python",
        "openai:gpt-5-mini",
        "low",
        5,
        "openai:gpt-5-nano",
    )
    item = result.parsed_resume.unassigned_highlights[0]
    assert item.text == "Built services using\nPython and PostgreSQL."
    assert item.source_context == "EXPERIENCE\nAcme | Engineer"


def test_all_supported_models_fit_existing_public_result(offline_model_resolution):
    async def answer(messages, info):
        fields = [
            (
                "contact",
                {
                    "full_name": "Candidate",
                    "links": [{"label": "Portfolio", "url": "https://example.test"}],
                },
            ),
            ("summary", {"text": "Builds useful tools."}),
            ("education", {"institution": "Example University", "degree": "BSc"}),
            ("certification", {"name": "Example Credential", "issued_date": "2024-02-29"}),
            ("project", {"name": "Atlas", "description": "Built maps."}),
            ("skill", {"name": "Python", "category": "Languages"}),
        ]
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {"type": kind, "source_id": "S1", "fields": values}
                            for kind, values in fields
                        ],
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parsed = run_import().parsed_resume
    assert parsed.contact.full_name == "Candidate"
    assert parsed.summary == "Builds useful tools."
    assert parsed.educations[0].institution == "Example University"
    assert parsed.certifications[0].issued_date == "2024-02-29"
    assert parsed.projects[0].name == "Atlas"
    assert parsed.skills[0].category == "Languages"


def test_output_token_cap_preserves_concrete_failed_usage(monkeypatch, offline_model_resolution):
    import pytest
    from pydantic_ai.exceptions import UsageLimitExceeded
    from pydantic_ai.usage import RequestUsage, UsageLimits

    from worker.task_usage import collect_task_usage

    async def answer(messages, info):
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=10, output_tokens=20),
        )

    monkeypatch.setattr(
        "resume_import.agent_usage_limits", lambda settings: UsageLimits(output_tokens_limit=2)
    )
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with collect_task_usage() as usage, pytest.raises(UsageLimitExceeded):
        run_import()
    assert sum(entry.output_tokens for entry in usage.entries) == 20
