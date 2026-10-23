"""Protect model-facing source IDs and preserve bullets omitted by extraction."""

from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from resume_import import import_resume_text


def parse(text):
    return import_resume_text(
        text, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-nano"
    ).parsed_resume


def test_omitted_shared_bullet_is_preserved_for_placement(offline_model_resolution):
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
                                "fields": {"company": "Acme", "title": "Engineer"},
                            },
                            {
                                "type": "experience",
                                "source_id": "S3",
                                "fields": {"company": "Acme", "title": "Senior Engineer"},
                            },
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parsed = parse("EXPERIENCE\nEngineer at Acme\nSenior Engineer at Acme\n• Shared delivery work.")
    assert [item.text for item in parsed.unassigned_highlights] == ["Shared delivery work."]
    assert parsed.unassigned_highlights[0].source_id == "S4"
    assert parsed.unassigned_highlights[0].reason == "ambiguous_role"
    assert (
        parsed.unassigned_highlights[0].source_context
        == "EXPERIENCE\nEngineer at Acme\nSenior Engineer at Acme"
    )


def test_provider_schema_exposes_only_chunk_owned_bare_source_ids(offline_model_resolution):
    import re

    calls = []

    async def answer(messages, info):
        prompt = messages[-1].parts[-1].content
        owned = set(re.findall(r"\[(S\d+)\]", prompt))
        schema = info.output_tools[0].parameters_json_schema
        definitions = schema.get("$defs", {})

        def resolve(value):
            return definitions[value["$ref"].rsplit("/", 1)[1]] if "$ref" in value else value

        anchors = []
        for model in definitions.values():
            properties = model.get("properties", {})
            if "source_id" in properties:
                choices = resolve(properties["source_id"])
                allowed = set(choices.get("enum", [choices.get("const")]))
                assert None not in allowed, "source IDs must be enumerated for the provider"
                assert allowed <= owned
                anchors.append(allowed)
            for field in ("supporting_ids", "highlight_ids"):
                if field in properties:
                    choices = resolve(properties[field]["items"])
                    allowed = set(choices.get("enum", [choices.get("const")]))
                    assert None not in allowed
                    assert allowed <= owned
        assert owned in anchors
        calls.append(owned)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parse(
        "SUMMARY\nA candidate.\nSKILLS\n• Python\nPROJECTS\nAtlas\n• Built maps.\nEXPERIENCE\nAcme | Engineer\n• Built APIs."
    )
    assert len(calls) == 2
    assert calls[0].isdisjoint(calls[1])


def test_nonexperience_citations_and_bullet_anchors_avoid_false_pending(offline_model_resolution):
    async def answer(messages, info):
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {
                                "type": "project",
                                "source_id": "S2",
                                "supporting_ids": ["S3"],
                                "fields": {"name": "Atlas", "description": "Built maps."},
                            },
                            {"type": "skill", "source_id": "S4", "fields": {"name": "Python"}},
                            {
                                "type": "skill",
                                "source_id": "S1",
                                "supporting_ids": ["S4"],
                                "fields": {"name": "SQL"},
                            },
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parsed = parse("PROJECTS\nAtlas\n• Built maps.\n• Python and SQL")
    assert not parsed.unassigned_highlights
    assert parsed.projects[0].description == "Built maps."
    assert {item.name for item in parsed.skills} == {"Python", "SQL"}


def test_experience_anchor_does_not_consume_uncited_bullet(offline_model_resolution):
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
                                    "description": "Built maps.",
                                },
                            },
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    assert parse("EXPERIENCE\n• Built maps.").unassigned_highlights[0].text == "Built maps."


def test_bracketed_ids_retry_with_allowed_bare_ids_and_can_recover(offline_model_resolution):
    from pydantic_ai.messages import RetryPromptPart

    calls = []

    async def answer(messages, info):
        calls.append(True)
        if len(calls) > 1:
            retries = [
                part
                for message in messages
                for part in message.parts
                if isinstance(part, RetryPromptPart)
            ]
            assert retries
            assert "S2" in str(retries[-1].content)
            assert "literal_error" in str(retries[-1].content)
        source_id = "[S2]" if len(calls) == 1 else "S2"
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {"type": "skill", "source_id": source_id, "fields": {"name": "Python"}},
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parsed = parse("SKILLS\n• Python")
    assert calls == [True, True]
    assert parsed.skills[0].name == "Python"
    assert not parsed.unassigned_highlights


def test_unknown_supporting_ids_fail_instead_of_consuming_a_source(offline_model_resolution):
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
                                "type": "project",
                                "source_id": "S2",
                                "supporting_ids": ["S999"],
                                "fields": {"name": "Atlas"},
                            },
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UnexpectedModelBehavior):
        parse("PROJECTS\nAtlas\n• Built maps.")


def test_cli_returns_failure_for_native_case_errors(monkeypatch, offline_model_resolution):
    import runpy
    import sys

    import pytest
    from pydantic_evals import Case, Dataset

    async def answer(messages, info):
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {"type": "skill", "source_id": "[S2]", "fields": {"name": "Python"}},
                        ]
                    },
                )
            ]
        )

    def evaluate_single_case(load_dataset, task, **kwargs):
        # Keep the real native report and production task; avoid unrelated global telemetry.
        return Dataset(
            name="cli_failure", cases=[Case(name="invalid_id", inputs="SKILLS\n• Python")]
        ).evaluate_sync(task)

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(answer))
    monkeypatch.setenv("RESUME_PARSING_MODEL", "openai:gpt-5-mini")
    monkeypatch.setattr("evals.telemetry.evaluate_dataset", evaluate_single_case)
    monkeypatch.delitem(sys.modules, "evals.run_resume_import_evals", raising=False)
    with pytest.raises(SystemExit) as exited:
        runpy.run_module("evals.run_resume_import_evals", run_name="__main__")
    assert exited.value.code == 1


def test_fallback_pending_preserves_explicit_reasons_and_source_order(offline_model_resolution):
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
                                    "highlight_ids": ["S4"],
                                },
                            }
                        ],
                        "unassigned_highlights": [{"source_id": "S5", "reason": "missing_role"}],
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parsed = parse("EXPERIENCE\nAcme | Engineer\n• Shared work.\n• Owned work.\n• Orphan work.")
    assert [(item.source_id, item.reason) for item in parsed.unassigned_highlights] == [
        ("S3", "ambiguous_role"),
        ("S5", "missing_role"),
    ]
    assert parsed.experiences[0].highlights == ["Owned work."]


def test_supporting_reference_cannot_consume_a_sibling_chunk(offline_model_resolution):
    import re

    import pytest
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    async def answer(messages, info):
        prompt = messages[0].parts[-1].content
        owned = re.findall(r"\[(S\d+)\]", prompt)
        records = (
            []
            if "S1" in owned
            else [
                {
                    "type": "skill",
                    "source_id": owned[0],
                    "supporting_ids": ["S1"],
                    "fields": {"name": "Python"},
                }
            ]
        )
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"records": records})])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UnexpectedModelBehavior):
        parse("SUMMARY\nProfile.\nSKILLS\nPython\nPROJECTS\nAtlas\nEXPERIENCE\nAcme | Engineer")


def test_no_bullet_document_needs_no_references(offline_model_resolution):
    async def answer(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    assert not parse("A candidate.").unassigned_highlights
    assert not parse("").unassigned_highlights


def test_large_sources_keep_provider_schema_size_bounded_without_losing_bullets(
    offline_model_resolution,
):
    import json

    schema_sizes = []

    async def answer(messages, info):
        schema_sizes.append(len(json.dumps(info.output_tools[0].parameters_json_schema)))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    for count in (400, 1600):
        parsed = parse(
            "EXPERIENCE\n"
            + "\n".join(f"• Shared synthetic delivery result {index}." for index in range(count))
        )
        assert len(parsed.unassigned_highlights) == count
    assert schema_sizes[0] == schema_sizes[1], (
        "large-input schemas must not scale with source count"
    )


def test_large_source_still_rejects_unknown_ids_with_bounded_retry_guidance(
    offline_model_resolution,
):
    import pytest
    from pydantic_ai.exceptions import UnexpectedModelBehavior
    from pydantic_ai.messages import RetryPromptPart

    retries = []

    async def answer(messages, info):
        retries.extend(
            str(part.content)
            for message in messages
            for part in message.parts
            if isinstance(part, RetryPromptPart)
        )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "records": [
                            {"type": "skill", "source_id": "S999999", "fields": {"name": "Python"}},
                        ]
                    },
                )
            ]
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UnexpectedModelBehavior):
        parse("SKILLS\n" + "\n".join(f"• Synthetic skill {index}" for index in range(400)))
    assert retries
    assert "allowed IDs: S1, S2" in retries[0]
    assert "see remaining labels in this chunk" in retries[0]
    assert len(retries[0]) < 1500


def test_bullet_cannot_be_pending_or_assigned_and_nonexperience_evidence(offline_model_resolution):
    import pytest
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    for disposition in ("pending", "assigned"):

        async def answer(messages, info, disposition=disposition):
            payload = {
                "records": [
                    {
                        "type": "project",
                        "source_id": "S2",
                        "supporting_ids": ["S3"],
                        "fields": {"name": "Atlas", "description": "Built maps."},
                    }
                ]
            }
            if disposition == "pending":
                payload["unassigned_highlights"] = [{"source_id": "S3", "reason": "ambiguous_role"}]
            else:
                payload["records"].append(
                    {
                        "type": "experience",
                        "source_id": "S2",
                        "fields": {
                            "company": "Acme",
                            "title": "Engineer",
                            "highlight_ids": ["S3"],
                        },
                    }
                )
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, payload)])

        offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
        with pytest.raises(UnexpectedModelBehavior):
            parse("PROJECTS\nAtlas\n• Built maps.")


def test_eval_scores_unexpected_contact_name_and_project_link():
    from types import SimpleNamespace

    from evals.run_resume_import_evals import load_resume_import_dataset
    from schemas.parsed_resume import ParsedResume

    expected = ParsedResume(projects=[{"name": "Atlas", "url": "https://example.test/atlas"}])
    actual = expected.model_copy(
        update={
            "contact": ParsedResume.model_validate(
                {
                    "contact": {
                        "full_name": "Atlas",
                        "links": [{"label": "Atlas", "url": "https://example.test/atlas"}],
                    }
                }
            ).contact
        }
    )
    ctx = SimpleNamespace(
        inputs="PROJECTS\nAtlas\nhttps://example.test/atlas",
        expected_output=expected,
        output=actual,
        metadata={},
    )
    scores = {
        key: value
        for evaluator in load_resume_import_dataset().evaluators
        for key, value in evaluator.evaluate(ctx).items()
    }
    assert scores.get("candidate_name_match") == 0
    assert scores.get("contact_link_precision") == 0


def test_eval_requires_genuine_contact_beside_person_like_project():
    from types import SimpleNamespace

    from evals.resume_import_evaluators import ContactAttribution
    from evals.run_resume_import_evals import load_resume_import_dataset
    from schemas.parsed_resume import ParsedContactInfo, ParsedLink

    case = next(
        case
        for case in load_resume_import_dataset().cases
        if case.name == "explicit_contact_and_person_like_project_name"
    )
    ctx = SimpleNamespace(expected_output=case.expected_output, output=case.expected_output)
    assert set(ContactAttribution().evaluate(ctx).values()) == {1.0}
    ctx.output = case.expected_output.model_copy(update={"contact": ParsedContactInfo()})
    missing = ContactAttribution().evaluate(ctx)
    assert missing["candidate_name_match"] == 0
    assert missing["contact_link_recall"] == 0
    ctx.output = case.expected_output.model_copy(
        update={
            "contact": case.expected_output.contact.model_copy(
                update={
                    "links": [
                        *case.expected_output.contact.links,
                        ParsedLink(label="Atlas", url="https://example.test/atlas"),
                    ]
                },
            )
        }
    )
    misplaced = ContactAttribution().evaluate(ctx)
    assert misplaced["candidate_name_match"] == 1
    assert misplaced["contact_link_precision"] == 0.5
    assert misplaced["contact_link_recall"] == 1
