"""Retry only positively contradicted source grouping and explicit shared-list omissions.

Unfamiliar layouts stay model-owned. These checks exercise the runtime output schema,
including its normal Pydantic AI retry path in the existing grouped parser tests.
"""

import pytest
from pydantic import ValidationError

from documents.experience_source import ExperienceSource


@pytest.mark.parametrize("company", ["Harbor Tools", "«pii:test:PERSON:1»"])
@pytest.mark.parametrize("location", ["", " | Remote"])
def test_one_company_heading_cannot_be_split_into_separate_entries(company, location):
    source = ExperienceSource(f"EXPERIENCE\n{company}{location}\nLead Engineer\n2022 – Present\n• Led releases.\nEngineer\n2019 – 2022\n• Built APIs.")
    with pytest.raises(ValidationError, match="single company heading"):
        source.output_type.model_validate({"experiences": [
            {"company": company, "roles": [{"title": "Lead Engineer", "highlight_ids": ["B1"]}]},
            {"company": company, "roles": [{"title": "Engineer", "highlight_ids": ["B2"]}]},
        ]})


def test_repeated_title_company_headers_cannot_be_collapsed_into_one_entry():
    source = ExperienceSource("EXPERIENCE\nLead Engineer — Harbor Tools\n2022 – Present\n• Led releases.\nEngineer — Harbor Tools\n2019 – 2022\n• Built APIs.")
    with pytest.raises(ValidationError, match="separate source employment blocks"):
        source.output_type.model_validate({"experiences": [{"company": "Harbor Tools", "roles": [
            {"title": "Lead Engineer", "highlight_ids": ["B1"]},
            {"title": "Engineer", "highlight_ids": ["B2"]},
        ]}]})


@pytest.mark.parametrize("selection", ["missing", "role"])
@pytest.mark.parametrize("company", ["Harbor Tools", "«pii:test:PERSON:1»"])
@pytest.mark.parametrize("location", ["", " | Remote"])
def test_explicit_shared_list_must_be_selected_once_in_shared_scope(selection, company, location):
    source = ExperienceSource(f"EXPERIENCE\n{company}{location}\nLead Engineer\n2022 – Present\nEngineer\n2019 – 2022\nShared accomplishments across both roles\n• Built a common SDK.\nPROJECTS\n• Built a personal site.")
    roles = [{"title": "Lead Engineer"}, {"title": "Engineer"}]
    if selection == "role":
        roles[1]["highlight_ids"] = ["B1"]
    with pytest.raises(ValidationError, match="explicitly shared source bullets"):
        source.output_type.model_validate({"experiences": [{"company": company, "roles": roles}]})


@pytest.mark.parametrize("grouped", [True, False])
def test_correct_dated_layouts_and_mixed_scopes_are_accepted(grouped):
    heading = "Harbor Tools\nLead Engineer" if grouped else "Lead Engineer — Harbor Tools"
    second = "Engineer" if grouped else "Engineer — Harbor Tools"
    source = ExperienceSource(f"EXPERIENCE\n{heading}\n2022 – Present\n• Led releases.\n{second}\n2019 – 2022\n• Built APIs.")
    roles = [{"title": "Lead Engineer", "highlight_ids": ["B1"]}, {"title": "Engineer", "highlight_ids": ["B2"]}]
    experiences = ([{"company": "Harbor Tools", "roles": roles}] if grouped else
                   [{"company": "Harbor Tools", "roles": [role]} for role in roles])
    output = source.output_type.model_validate({"experiences": experiences})
    assert len(source.reconstruct(output)["experiences"]) == (1 if grouped else 2)


def test_unfamiliar_undated_layout_does_not_claim_a_grouping_rule():
    source = ExperienceSource("EXPERIENCE\nHarbor Tools\nLead Engineer\n• Led releases.\nEngineer\n• Built APIs.")
    output = source.output_type.model_validate({"experiences": [
        {"company": "Harbor Tools", "title": "Lead Engineer", "highlight_ids": ["B1"]},
        {"company": "Harbor Tools", "title": "Engineer", "highlight_ids": ["B2"]},
    ]})
    assert len(output.experiences) == 2


def test_company_first_initial_role_and_later_title_only_role_can_share_one_block():
    source = ExperienceSource("EXPERIENCE\nHarbor Tools | Lead Engineer\n2022 – Present\n• Led releases.\nEngineer\n2019 – 2022\n• Built APIs.")
    output = source.output_type.model_validate({"experiences": [{"company": "Harbor Tools", "roles": [
        {"title": "Lead Engineer", "highlight_ids": ["B1"]}, {"title": "Engineer", "highlight_ids": ["B2"]},
    ]}]})
    assert len(output.experiences[0].roles) == 2


@pytest.mark.parametrize("prefix", ["PROJECTS", "EDUCATION", "SKILLS"])
def test_non_employment_shared_lists_do_not_require_experiences(prefix):
    source = ExperienceSource(f"{prefix}\nShared accomplishments\n• Built a personal site.")
    assert source.output_type.model_validate({}).experiences == []


def test_a_later_project_shared_list_does_not_enter_employment_requirements():
    source = ExperienceSource("EXPERIENCE\nHarbor Tools\nEngineer\n2020 – Present\n• Built APIs.\nPROJECTS\nShared accomplishments\n• Built a personal site.")
    output = source.output_type.model_validate({"experiences": [{"company": "Harbor Tools", "title": "Engineer", "highlight_ids": ["B1"]}]})
    assert source.reconstruct(output)["experiences"][0]["roles"][0]["highlights"] == ["Built APIs."]


def test_unsectioned_shared_list_without_employment_header_evidence_stays_unbound():
    source = ExperienceSource("Shared accomplishments\n• Built a personal site.")
    assert source.output_type.model_validate({}).experiences == []


def test_parser_retries_contradicted_layout_and_returns_the_complete_group(offline_model_resolution):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from agents.resume_parsing_agent import parse_resume_text

    source = "EXPERIENCE\nHarbor Tools\nLead Engineer\n2022 – Present\n• Led releases.\nEngineer\n2019 – 2022\n• Built APIs.\nShared accomplishments across both roles\n• Maintained a shared SDK."
    attempts = 0

    async def answer(messages, info):
        nonlocal attempts
        args = {}
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            attempts += 1
            roles = [{"title": "Lead Engineer", "highlight_ids": ["B1"]},
                     {"title": "Engineer", "highlight_ids": ["B2"]}]
            args = {"experiences": ([{"company": "Harbor Tools", "roles": [role]} for role in roles]
                    if attempts == 1 else [{"company": "Harbor Tools", "roles": roles, "shared_highlight_ids": ["B3"]}])}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    run = parse_resume_text(source, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini")
    assert attempts == 2
    assert len(run.parsed_resume.experiences) == 1
    entry = run.parsed_resume.experiences[0]
    assert [role.title for role in entry.roles] == ["Lead Engineer", "Engineer"]
    assert [role.highlights for role in entry.roles] == [["Led releases."], ["Built APIs."]]
    assert entry.shared_highlights == ["Maintained a shared SDK."]
