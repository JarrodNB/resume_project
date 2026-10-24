"""Check automatic bullet placement through the public importer with offline models."""

from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel


def _import():
    from resume_import import import_resume_text

    return import_resume_text(
        "Experience\nAcme | Engineer\n• Built Atlas APIs\nAcme | Manager\n• Led hiring\n• Expanded Atlas APIs",
        "openai:gpt-5-mini", "low", 10, "openai:gpt-5-nano",
    ).parsed_resume


def test_model_places_only_bullet_with_unique_existing_evidence(offline_model_resolution):
    from agents.resume_placement_agent import resume_placement_agent

    async def extract(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "records": [
                {"type": "experience", "source_id": "S2", "fields": {
                    "company": "Acme", "title": "Engineer", "highlight_ids": ["S3"]}},
                {"type": "experience", "source_id": "S4", "fields": {
                    "company": "Acme", "title": "Manager", "highlight_ids": ["S5"]}},
            ],
            "unassigned_highlights": [{"source_id": "S6", "reason": "ambiguous_role"}],
        })])

    async def place(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "suggestions": [{"bullet_id": "S6", "role_id": "S2", "evidence_id": "S3"}]
        })])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(extract))
    with resume_placement_agent.override(model=FunctionModel(place)):
        parsed = _import()
    assert parsed.experiences[0].highlights == ["Built Atlas APIs", "Expanded Atlas APIs"]
    assert parsed.unassigned_highlights == []


def test_model_cannot_place_without_specific_existing_evidence(offline_model_resolution):
    from agents.resume_placement_agent import resume_placement_agent

    async def extract(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "records": [
                {"type": "experience", "source_id": "S2", "fields": {
                    "company": "Acme", "title": "Engineer", "highlight_ids": ["S3"]}},
                {"type": "experience", "source_id": "S4", "fields": {
                    "company": "Acme", "title": "Manager", "highlight_ids": ["S5"]}},
            ],
            "unassigned_highlights": [{"source_id": "S6", "reason": "ambiguous_role"}],
        })])

    async def place(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "suggestions": [{"bullet_id": "S6", "role_id": "S4", "evidence_id": "S5"}]
        })])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(extract))
    with resume_placement_agent.override(model=FunctionModel(place)):
        parsed = _import()
    assert [item.source_id for item in parsed.unassigned_highlights] == ["S6"]


def test_one_role_places_adjacent_bullet_but_not_later_section(offline_model_resolution):
    from resume_import import import_resume_text

    async def extract(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "records": [{"type": "experience", "source_id": "S2", "fields": {
                "company": "Acme", "title": "Engineer"}}],
            "unassigned_highlights": [
                {"source_id": "S3", "reason": "ambiguous_role"},
                {"source_id": "S5", "reason": "ambiguous_role"},
            ],
        })])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(extract))
    parsed = import_resume_text(
        "Experience\nAcme | Engineer\n• Built APIs\nProjects\n• Built maps",
        "openai:gpt-5-mini", "low", 10, "openai:gpt-5-nano",
    ).parsed_resume
    assert parsed.experiences[0].highlights == ["Built APIs"]
    assert [item.source_id for item in parsed.unassigned_highlights] == ["S5"]


def test_optional_placement_failure_keeps_review_bullet(offline_model_resolution):
    from agents.resume_placement_agent import resume_placement_agent

    async def extract(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "records": [
                {"type": "experience", "source_id": "S2", "fields": {
                    "company": "Acme", "title": "Engineer", "highlight_ids": ["S3"]}},
                {"type": "experience", "source_id": "S4", "fields": {
                    "company": "Acme", "title": "Manager", "highlight_ids": ["S5"]}},
            ],
            "unassigned_highlights": [{"source_id": "S6", "reason": "ambiguous_role"}],
        })])

    async def fail(messages, info):
        raise RuntimeError("placement unavailable")

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(extract))
    with resume_placement_agent.override(model=FunctionModel(fail)):
        assert [item.source_id for item in _import().unassigned_highlights] == ["S6"]
