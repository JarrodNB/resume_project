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
    assert len(dataset.cases) == 4
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


def test_structural_sections_extract_concurrently_with_global_ids(offline_model_resolution):
    import asyncio
    import re

    from resume_import import import_resume_text

    active = 0
    peak = 0
    inputs = []

    async def answer(messages, info):
        nonlocal active, peak
        prompt = messages[-1].parts[-1].content
        inputs.append(prompt)
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        active -= 1
        ids = re.findall(r"\[(S\d+)\]", prompt)
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {"type": "skill", "source_id": ids[-1], "fields": {"name": ids[-1]}}
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = import_resume_text(
        "Experience\nAcme | Engineer\n• Built tools\n\nEducation\nExample University\n\nSkills\nPython\n\nProjects\nAtlas",
        "openai:gpt-5-mini",
        "low",
        5,
        "openai:gpt-5-nano",
    )
    assert 1 < peak <= 3
    assert len(inputs) <= 6
    names = [item.name for item in result.parsed_resume.skills]
    assert len(names) == len(set(names))
    assert names == sorted(names, key=lambda value: int(value[1:]))


MULTI_SECTION = "\nExperience\nAcme\nEngineer, 2020 - 2022\nSenior Engineer, 2022 - Present\n• Shared platform\n  with careful tests.\n\nEducation\nExample University\n\nSkills\nPython\n\nProjects\nAtlas\nUnknown heading\n[Link: Portfolio] https://example.test"


def test_chunks_cover_source_once_and_screen_exact_complete_inputs(
    monkeypatch, offline_model_resolution
):
    import re

    from pydantic_ai.usage import RunUsage

    from agents.user_text_screen_agent import UserTextScreenRun
    from resume_import import import_resume_text
    from schemas.user_text_screen import UserTextScreen

    screened = []
    prompts = []

    async def screen(text, *args):
        screened.append(text)
        return UserTextScreenRun(
            UserTextScreen(prompt_injection=False, harmful_request=False),
            "jev-1.13.0",
            {"prompt_injection": 1.0, "harmful_request": 1.0},
            RunUsage(),
        )

    async def answer(messages, info):
        prompt = messages[-1].parts[-1].content
        prompts.append(prompt)
        refs = [{"source_id": "S5", "reason": "ambiguous_role"}] if "[S5]" in prompt else []
        records = (
            [
                {
                    "type": "experience",
                    "source_id": source_id,
                    "fields": {"company": "Acme", "title": title},
                }
                for source_id, title in [("S3", "Engineer"), ("S4", "Senior Engineer")]
            ]
            if refs
            else []
        )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name, {"records": records, "unassigned_highlights": refs}
                )
            ]
        )

    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", screen)
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = import_resume_text(MULTI_SECTION, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano")
    assert "\n".join(screened) == MULTI_SECTION
    assert len(screened) == len(prompts) == 2
    for raw, prompt in zip(screened, prompts):
        assert (
            re.sub(r"\[S\d+\] ", "", prompt.removeprefix("<resume>\n").removesuffix("\n</resume>"))
            == raw
        )
    assert (
        result.parsed_resume.unassigned_highlights[0].text == "Shared platform\nwith careful tests."
    )
    assert result.parsed_resume.unassigned_highlights[0].source_id == "S5"
    assert [item.title for item in result.parsed_resume.experiences] == [
        "Engineer",
        "Senior Engineer",
    ]
    assert all(
        item.company == "Acme" and not item.highlights for item in result.parsed_resume.experiences
    )


def test_chunk_cannot_claim_sibling_source_even_when_globally_valid(offline_model_resolution):
    import pytest
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    from resume_import import import_resume_text

    async def answer(messages, info):
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"unassigned_highlights": [{"source_id": "S5", "reason": "ambiguous_role"}]},
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UnexpectedModelBehavior):
        import_resume_text(MULTI_SECTION, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano")


def test_parallel_required_failure_cancels_and_awaits_siblings(offline_model_resolution):
    import asyncio

    import pytest

    from resume_import import import_resume_text

    started = asyncio.Event()
    cancelled = []

    async def answer(messages, info):
        prompt = messages[-1].parts[-1].content
        if "Shared platform" in prompt:
            await started.wait()
            raise RuntimeError("required chunk failed")
        started.set()
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(RuntimeError, match="required chunk failed"):
        import_resume_text(MULTI_SECTION, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano")
    assert cancelled == [True]


def test_shared_request_cap_reserves_before_concurrent_requests(
    monkeypatch, offline_model_resolution
):
    import asyncio

    import pytest
    from pydantic_ai.exceptions import UsageLimitExceeded
    from pydantic_ai.usage import UsageLimits

    from resume_import import import_resume_text

    calls = []

    async def answer(messages, info):
        calls.append(True)
        await asyncio.sleep(0.02)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])

    monkeypatch.setattr(
        "resume_import.agent_usage_limits", lambda settings: UsageLimits(request_limit=1)
    )
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UsageLimitExceeded):
        import_resume_text(MULTI_SECTION, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano")
    assert len(calls) == 1


def test_shared_token_cap_includes_all_completed_chunks(monkeypatch, offline_model_resolution):
    import pytest
    from pydantic_ai.exceptions import UsageLimitExceeded
    from pydantic_ai.usage import RequestUsage, UsageLimits

    from resume_import import import_resume_text

    async def answer(messages, info):
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})], usage=RequestUsage(output_tokens=6)
        )

    monkeypatch.setattr(
        "resume_import.agent_usage_limits", lambda settings: UsageLimits(output_tokens_limit=10)
    )
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UsageLimitExceeded):
        import_resume_text(MULTI_SECTION, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano")


def test_uncertain_layout_stays_one_chunk(offline_model_resolution):
    from resume_import import import_resume_text

    calls = []

    async def answer(messages, info):
        calls.append(messages[-1].parts[-1].content)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    import_resume_text(
        "Acme\nEngineer\n\n• Built systems\nUnknown heading\n• Python",
        "openai:gpt-5-mini",
        "low",
        5,
        "openai:gpt-5-nano",
    )
    assert len(calls) == 1


def test_cross_chunk_singletons_fail_instead_of_overwriting(offline_model_resolution):
    import re

    import pytest

    from resume_import import import_resume_text

    async def answer(messages, info):
        source_id = re.search(r"\[(S\d+)\]", messages[-1].parts[-1].content)[1]
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {
                                "type": "summary",
                                "source_id": source_id,
                                "fields": {"text": "Conflicting summary"},
                            }
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(ValueError, match="only one contact and one summary"):
        import_resume_text(MULTI_SECTION, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano")


def test_pdf_and_docx_real_extraction_reach_chunked_import(offline_model_resolution):
    import re
    from io import BytesIO

    from docx import Document
    from pypdf import PdfWriter
    from pypdf.annotations import Link
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    from documents.extract_document_text import (
        DOCX_CONTENT_TYPE,
        PDF_CONTENT_TYPE,
        extract_document_text,
    )
    from resume_import import import_resume_text

    lines = [
        "Experience",
        "Acme | Engineer",
        "- Built tools",
        "Education",
        "Example University",
        "Skills",
        "Python",
        "Projects",
        "Atlas",
    ]
    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    doc_buffer = BytesIO()
    doc.save(doc_buffer)
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    stream = DecodedStreamObject()
    commands = (
        "BT /F1 12 Tf 40 750 Td " + " ".join(f"({line}) Tj 0 -20 Td" for line in lines) + " ET"
    )
    stream.set_data(commands.encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    writer.add_annotation(0, Link(rect=(40, 550, 200, 570), url="https://example.test/portfolio"))
    pdf_buffer = BytesIO()
    writer.write(pdf_buffer)

    prompts = []

    async def answer(messages, info):
        prompt = messages[-1].parts[-1].content
        prompts.append(prompt)
        refs = []
        for source_id, line in re.findall(r"\[(S\d+)\] ([^\n]+)", prompt):
            if "Built tools" in line:
                refs.append({"source_id": source_id, "reason": "missing_role"})
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {"unassigned_highlights": refs})]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    for data, content_type in [
        (doc_buffer.getvalue(), DOCX_CONTENT_TYPE),
        (pdf_buffer.getvalue(), PDF_CONTENT_TYPE),
    ]:
        text = extract_document_text(data, content_type)
        result = import_resume_text(text, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano")
        assert result.parsed_resume.unassigned_highlights[0].text == "Built tools"
    assert any("https://example.test/portfolio" in prompt for prompt in prompts)


def test_three_pipelines_share_one_deadline_including_screening(
    monkeypatch, offline_model_resolution
):
    import asyncio

    import pytest
    from pydantic_ai.usage import RunUsage

    from agents.user_text_screen_agent import UserTextScreenRun
    from resume_import import import_resume_text
    from schemas.user_text_screen import UserTextScreen

    active = 0
    peak = 0
    closed = []
    timeout_scopes = []
    real_timeout = asyncio.timeout

    def capture_timeout(delay):
        scope = real_timeout(delay)
        timeout_scopes.append(scope)
        return scope

    async def screen(text, *args):
        await asyncio.sleep(0.02)
        return UserTextScreenRun(
            UserTextScreen(prompt_injection=False, harmful_request=False),
            "jev-1.13.0",
            {"prompt_injection": 1.0, "harmful_request": 1.0},
            RunUsage(),
        )

    async def answer(messages, info):
        nonlocal active, peak
        active += 1
        peak = max(active, peak)
        try:
            if active == 3:
                # Expire the actual outer import deadline only after all providers
                # are running. Schema/provider setup speed is irrelevant here.
                timeout_scopes[0].reschedule(asyncio.get_running_loop().time())
            await asyncio.Event().wait()
        finally:
            active -= 1
            closed.append(True)

    monkeypatch.setattr("resume_import.asyncio.timeout", capture_timeout)
    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", screen)
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    text = MULTI_SECTION + "\nCertifications\nCertified\nLanguages\nEnglish"
    with pytest.raises(TimeoutError):
        import_resume_text(text, "openai:gpt-5-mini", "low", 30, "openai:gpt-5-nano")
    assert timeout_scopes[0].expired()
    assert peak == 3
    assert active == 0
    assert closed == [True] * 3


def test_uppercase_acronym_continuation_stays_in_verbatim_highlight(offline_model_resolution):
    from resume_import import import_resume_text

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
                                    "highlight_ids": ["S3"],
                                },
                            }
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parsed = import_resume_text(
        "EXPERIENCE\nAcme | Engineer\n- Built reporting in\nSQL\n\nSKILLS\nPython",
        "openai:gpt-5-mini",
        "low",
        5,
        "openai:gpt-5-nano",
    ).parsed_resume
    assert parsed.experiences[0].highlights == ["Built reporting in\nSQL"]


def test_wrapped_acronyms_preserve_following_sections_and_dated_role_boundaries(
    offline_model_resolution,
):
    from resume_import import import_resume_text

    async def answer(messages, info):
        prompt = messages[-1].parts[-1].content
        assert "[S4] SENIOR ENGINEER" in prompt
        assert "[S7] SKILLS" in prompt
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
                            },
                            {
                                "type": "experience",
                                "source_id": "S4",
                                "fields": {
                                    "company": "Acme",
                                    "title": "Senior Engineer",
                                    "highlight_ids": ["S6"],
                                },
                            },
                            {"type": "skill", "source_id": "S8", "fields": {"name": "Python"}},
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parsed = import_resume_text(
        "EXPERIENCE\nAcme | Engineer\n- Built reporting in\nSQL\nSENIOR ENGINEER\n2022 - Present\n- Deployed to\nAWS\nSKILLS\nPython",
        "openai:gpt-5-mini",
        "low",
        5,
        "openai:gpt-5-nano",
    ).parsed_resume
    assert [entry.highlights for entry in parsed.experiences] == [
        ["Built reporting in\nSQL"],
        ["Deployed to\nAWS"],
    ]
    assert parsed.skills[0].name == "Python"
