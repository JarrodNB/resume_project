"""Grouped employment retains shared and role source passages independently."""

import pytest
from pydantic import ValidationError

from documents.experience_source import ExperienceSource
from schemas.parsed_resume import ParsedResume


def test_grouped_source_reconstructs_each_scope_and_never_exposes_ids():
    source = ExperienceSource("EXPERIENCE\nExample Labs\nShared work\n• Built a common SDK.\nEngineer 2020 – 2022\n• Shipped an API.\nLead 2022 – Present\n• Led migration.")
    output = source.output_type.model_validate({"experiences": [{
        "company": "Example Labs", "shared_highlight_ids": ["B1"],
        "roles": [{"title": "Engineer", "highlight_ids": ["B2"]},
                  {"title": "Lead", "highlight_ids": ["B3"], "is_current": True}],
    }]})
    parsed = ParsedResume.model_validate(source.reconstruct(output))
    entry = parsed.experiences[0]
    assert entry.shared_highlights == ["Built a common SDK."]
    assert [role.highlights for role in entry.roles] == [["Shipped an API."], ["Led migration."]]
    assert "highlight_ids" not in parsed.model_dump_json()
    assert "title" not in parsed.model_dump()["experiences"][0]


@pytest.mark.parametrize("shared,roles", [(["B1"], [["B1"]]), ([], [["B1"], ["B1"]]), (["B404"], [[]])])
def test_duplicate_ids_are_rejected_across_shared_and_role_scopes(shared, roles):
    source = ExperienceSource("EXPERIENCE\n• Built a common SDK.")
    with pytest.raises(ValidationError, match="once per resume"):
        source.output_type.model_validate({"experiences": [{
            "company": "Example", "shared_highlight_ids": shared,
            "roles": [{"title": "Engineer", "highlight_ids": ids} for ids in roles],
        }]})


def test_legacy_flat_resume_normalizes_without_collapsing_same_company_entries():
    parsed = ParsedResume.model_validate({"experiences": [
        {"company": "Example", "title": title, "highlights": [title]}
        for title in ["Engineer", "Lead"]
    ]})
    assert len(parsed.experiences) == 2
    assert [entry.roles[0].title for entry in parsed.experiences] == ["Engineer", "Lead"]


def test_scope_heading_does_not_become_part_of_previous_role_bullet():
    source = ExperienceSource("EXPERIENCE\nExample\nEngineer\n2020 – Present\n• Shipped an API.\nShared accomplishments across both roles\n• Built a common SDK.")
    output = source.output_type.model_validate({"experiences": [{
        "company": "Example", "roles": [{"title": "Engineer", "highlight_ids": ["B1"]}],
        "shared_highlight_ids": ["B2"],
    }]})
    parsed = ParsedResume.model_validate(source.reconstruct(output))
    assert parsed.experiences[0].roles[0].highlights == ["Shipped an API."]


def test_nested_faithfulness_removes_unverifiable_bullets_from_every_scope():
    from documents.enforce_source_faithfulness import enforce_source_faithfulness

    parsed = ParsedResume.model_validate({"experiences": [{
        "company": "Example", "roles": [{"title": "Engineer", "highlights": ["Built an API.", "Invented role text."]}],
        "shared_highlights": ["Built an SDK.", "Invented shared text."],
    }]})
    result = enforce_source_faithfulness(parsed, "Example Engineer Built an API. Built an SDK.")
    assert result.experiences[0].roles[0].highlights == ["Built an API."]
    assert result.experiences[0].shared_highlights == ["Built an SDK."]
    assert len(result.parsing_warnings) == 2


@pytest.mark.parametrize("wrong", ["fragment", "extra", "duplicate", "ownership", "grouping", "role_fields"])
def test_strict_evaluation_rejects_deliberately_wrong_grouped_outputs(wrong):
    from types import SimpleNamespace

    from evals.resume_parsing_evaluators import ExperienceMatch

    expected = ParsedResume.model_validate({"experiences": [{"company": "Example", "roles": [
        {"title": "Lead", "start_date": "2022", "is_current": True, "highlights": ["Built a complete API for inventory."]},
        {"title": "Engineer", "start_date": "2020", "end_date": "2022"},
    ], "shared_highlights": ["Maintained a shared SDK."]}]})
    value = expected.model_dump()
    entry = value["experiences"][0]
    bullets = entry["roles"][0]["highlights"]
    if wrong == "fragment":
        bullets[:] = ["Built a complete API", "for inventory."]
    elif wrong == "extra":
        bullets.append("Invented a process.")
    elif wrong == "duplicate":
        bullets.append(bullets[0])
    elif wrong == "ownership":
        entry["roles"][1]["highlights"] = entry.pop("shared_highlights")
    elif wrong == "grouping":
        value["experiences"] = [{**entry, "roles": [role]} for role in entry["roles"]]
    else:
        entry["roles"][0]["is_current"] = False
    output = ParsedResume.model_validate(value)
    scores = ExperienceMatch().evaluate(SimpleNamespace(expected_output=expected, output=output, metadata={}))
    assert scores["experience_exact_structure"] == 0.0, scores
    assert any(score < 1.0 for score in scores.values()), scores


@pytest.mark.parametrize("header", [
    "Research Assistant, University of Toronto Statistics Department (2021 – 2023)",
    "Volunteer Web Developer, Chicago Food Share — Sep 2023 to Present",
    "Volunteer Web Developer, «pii:test:PERSON:1» — Sep 2023 to Present",
])
def test_ordinary_comma_headers_with_parenthesized_or_to_dates_stay_out_of_bullets(header):
    source = ExperienceSource(f"EXPERIENCE\nEngineer — Example\n2020 – Present\n• Built the original service.\n\n{header}\n• Improved the next service.")
    output = source.output_type.model_validate({"experiences": [{"company": "Example", "title": "Engineer", "highlight_ids": ["B1", "B2"]}]})
    parsed = ParsedResume.model_validate(source.reconstruct(output))
    assert parsed.experiences[0].roles[0].highlights == ["Built the original service.", "Improved the next service."]


@pytest.mark.parametrize("file_format", ["pdf", "docx"])
@pytest.mark.parametrize("case_name", [
    "grouped_shared_stack", "grouped_mixed_role_and_shared_lists",
    "separate_same_company_blocks", "grouped_wrapped_acronyms_and_blank_pages",
])
def test_synthetic_uploads_retain_grouping_and_complete_scoped_bullets(
    case_name, file_format, offline_model_resolution,
):
    import re
    from pathlib import Path
    from types import SimpleNamespace

    import yaml
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from agents.resume_parsing_agent import parse_resume_text
    from documents.extract_document_text import (
        DOCX_CONTENT_TYPE,
        PDF_CONTENT_TYPE,
        extract_document_text,
    )
    from documents.text_matching import normalize_text
    from evals.resume_import_fixtures import build_docx, build_pdf, fixture_pages
    from evals.resume_parsing_evaluators import ExperienceMatch

    cases = yaml.safe_load((Path(__file__).parents[1] / "evals/datasets/resume_parsing_cases.yaml").read_text())["cases"]
    case = next(item for item in cases if item["name"] == case_name)
    builder, content_type = (build_pdf, PDF_CONTENT_TYPE) if file_format == "pdf" else (build_docx, DOCX_CONTENT_TYPE)
    source_text = extract_document_text(builder(fixture_pages(case)), content_type)
    source = ExperienceSource(source_text)
    ids = re.findall(r"\[(B\d+)\]", source.annotated_text)
    all_bullets = source.reconstruct(source.output_type.model_validate({
        "experiences": [{"company": "Example", "title": "Engineer", "highlight_ids": ids}],
    }))["experiences"][0]["roles"][0]["highlights"]
    available = {normalize_text(text): bullet_id for text, bullet_id in zip(all_bullets, ids, strict=True)}
    expected = ParsedResume.model_validate(case["expected_output"])
    selection = expected.model_dump()
    for entry in selection["experiences"]:
        entry["shared_highlight_ids"] = [available[normalize_text(text)] for text in entry.pop("shared_highlights")]
        for role in entry["roles"]:
            role["highlight_ids"] = [available[normalize_text(text)] for text in role.pop("highlights")]

    async def answer(messages, info):
        fields = info.output_tools[0].parameters_json_schema["properties"]
        args = {"experiences": selection["experiences"]} if "experiences" in fields else {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    parsed = parse_resume_text(source_text, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini").parsed_resume
    scores = ExperienceMatch().evaluate(SimpleNamespace(expected_output=expected, output=parsed, metadata={}))
    assert all(score == 1.0 for score in scores.values()), scores


def test_grouped_privacy_restores_all_nested_text_without_leaking_internal_ids():
    from pii import prepare_document

    text = "Alex Doe helped alex.doe@example.test build the platform."
    masked, session = prepare_document(text, names=["Alex Doe"])
    assert "Alex Doe" not in masked and "alex.doe@example.test" not in masked
    parsed = ParsedResume.model_validate({"experiences": [{
        "company": masked, "location": masked, "description": masked,
        "roles": [{"title": masked, "description": masked, "highlights": [masked]}],
        "shared_highlights": [masked],
    }]})
    restored = session.restore(parsed).experiences[0]
    assert (restored.company, restored.location, restored.description) == (text, text, text)
    assert restored.roles[0].title == restored.roles[0].description == text
    assert restored.roles[0].highlights == restored.shared_highlights == [text]


@pytest.mark.parametrize("extra_company,accepted", [("Freelance", True), ("Unlabelled Extra", False)])
def test_strict_grouping_respects_only_labelled_extra_ambiguity(extra_company, accepted):
    from types import SimpleNamespace

    from evals.resume_parsing_evaluators import ExperienceMatch

    expected = ParsedResume(experiences=[{"company": "Example", "title": "Engineer", "highlights": ["Built an API."]}])
    output = ParsedResume(experiences=[*expected.experiences,
        {"company": extra_company, "title": "Developer"}])
    scores = ExperienceMatch().evaluate(SimpleNamespace(expected_output=expected, output=output,
                                                       metadata={"ambiguous_entries": ["Freelance"]}))
    assert scores["experience_exact_structure"] == float(accepted)
    assert (scores["experience_group_precision"] == 1.0) == accepted


def test_ambiguity_does_not_excuse_wrong_grouping_for_an_expected_employer():
    from types import SimpleNamespace

    from evals.resume_parsing_evaluators import ExperienceMatch

    expected = ParsedResume(experiences=[{"company": "Freelance", "roles": [{"title": "Engineer"}, {"title": "Lead"}]}])
    output = ParsedResume(experiences=[{"company": "Freelance", "title": "Engineer"}])
    scores = ExperienceMatch().evaluate(SimpleNamespace(expected_output=expected, output=output,
                                                       metadata={"ambiguous_entries": ["Freelance"]}))
    assert scores["experience_exact_structure"] == 0.0
    assert scores["experience_group_recall"] == 0.0
