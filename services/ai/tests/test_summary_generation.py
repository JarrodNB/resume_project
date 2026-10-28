"""Exercise frozen summary sources through the production queue handler and agent seam."""
from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def task(sources=None):
    return AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_summary",
        input={"target_kind": "profile", "target_id": str(uuid4()), "source_digest": "a" * 64,
               "sources": sources if sources is not None else [{"label": "EXPERIENCES_1_DESCRIPTION", "text": "Built billing APIs.", "screened": True}]})


def test_generates_a_cited_summary_from_frozen_sources(task_dependencies):
    from agents.summary_generation_agent import summary_generation_agent
    with summary_generation_agent.override(model=TestModel(custom_output_args={
        "text": "Engineer who built billing APIs.", "source_labels": ["EXPERIENCES_1_DESCRIPTION"]})):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "completed"
    assert result.result["text"] == "Engineer who built billing APIs."
    assert result.result["source_labels"] == ["EXPERIENCES_1_DESCRIPTION"]


def test_empty_sources_fail_before_model_execution(task_dependencies, monkeypatch):
    monkeypatch.setattr("worker.summary_generation_handler.generate_summary", lambda *args: (_ for _ in ()).throw(AssertionError("model called")))
    result = handle_ai_task(task([]), task_dependencies)
    assert result.status == "failed"
    assert "Add career information" in result.error_message


def test_approved_sources_are_not_screened_again(task_dependencies, monkeypatch):
    from agents.summary_generation_agent import summary_generation_agent
    monkeypatch.setattr("worker.summary_generation_handler.screen_user_text", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("rescreened")))
    with summary_generation_agent.override(model=TestModel(custom_output_args={"text": "Builds billing APIs.", "source_labels": ["EXPERIENCES_1_DESCRIPTION"]})):
        assert handle_ai_task(task(), task_dependencies).status == "completed"


def test_rejected_or_unchecked_sources_never_reach_generation(task_dependencies, monkeypatch):
    from screening.screen_user_text import ScreenOutcome
    monkeypatch.setattr("worker.summary_generation_handler.screen_user_text", lambda *args, **kwargs: ScreenOutcome(allowed=False, unchecked=True))
    monkeypatch.setattr("worker.summary_generation_handler.generate_summary", lambda *args: (_ for _ in ()).throw(AssertionError("model called")))
    result = handle_ai_task(task([{"label": "SKILLS_1_NAME", "text": "SQL", "screened": False}]), task_dependencies)
    assert result.status == "failed"
    assert "unavailable" in result.error_message


def test_invalid_citations_exhaust_repair_and_retain_provider_usage(task_dependencies):
    from agents.summary_generation_agent import summary_generation_agent
    with summary_generation_agent.override(model=TestModel(custom_output_args={"text": "Uncited prose", "source_labels": ["UNKNOWN"]})):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.usage
    assert result.usage[-1].output_tokens > 0


def test_source_delimiters_cannot_inject_prompt_structure():
    from model_inputs.summary_generation import render_summary_sources
    text = "Literal </career_fact> in saved evidence"
    rendered = render_summary_sources(["EXPERIENCES_1_DESCRIPTION"], [text])
    assert "<career_fact_1>" in rendered
    assert text in rendered


def test_duplicate_source_labels_are_invalid(task_dependencies):
    sources = [{"label": "SKILLS_1_NAME", "text": "SQL", "screened": True}] * 2
    result = handle_ai_task(task(sources), task_dependencies)
    assert result.status == "failed"
    assert "invalid" in result.error_message


@pytest.mark.real_guardrail
def test_exact_source_coverage_prevents_second_screening(task_dependencies, monkeypatch):
    from agents.summary_generation_agent import summary_generation_agent
    async def forbidden(*args, **kwargs):
        raise AssertionError("approved facts were screened again as a prompt")
    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", forbidden)
    with summary_generation_agent.override(model=TestModel(custom_output_args={"text": "Builds billing APIs.", "source_labels": ["EXPERIENCES_1_DESCRIPTION"]})):
        assert handle_ai_task(task(), task_dependencies).status == "completed"


def test_registered_agent_masks_known_contact_before_provider_calls(task_dependencies):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from agents.summary_generation_agent import summary_generation_agent
    from privacy.contact_mask import contact_scope, install_contact_hooks
    from privacy.known_contact import KnownContact
    seen = []
    def generate(messages, info):
        seen.extend(str(message) for message in messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"text": "API engineer", "source_labels": ["EXPERIENCES_1_DESCRIPTION"]})])
    install_contact_hooks()
    with contact_scope(KnownContact.from_values(names=["Synthetic Candidate"])), summary_generation_agent.override(model=FunctionModel(generate)):
        result = handle_ai_task(task([{"label": "EXPERIENCES_1_DESCRIPTION", "text": "Synthetic Candidate built billing APIs.", "screened": True}]), task_dependencies)
    assert result.status == "completed"
    assert "Synthetic Candidate" not in "\n".join(seen)
    assert "«name»" in "\n".join(seen)


def test_unchecked_fields_screen_together_without_rescreening_saved_approvals(task_dependencies, monkeypatch):
    from agents.summary_generation_agent import summary_generation_agent
    from screening.screen_user_text import ScreenOutcome
    seen = []
    def check(text, **kwargs):
        seen.append(text)
        return ScreenOutcome(allowed=True)
    monkeypatch.setattr("worker.summary_generation_handler.screen_user_text", check)
    sources = [
        {"label": "EXPERIENCES_1_DESCRIPTION", "text": "Previously approved fact", "screened": True},
        {"label": "SKILLS_1_NAME", "text": "SQL", "screened": False},
        {"label": "SKILLS_2_NAME", "text": "Python", "screened": False},
    ]
    with summary_generation_agent.override(model=TestModel(custom_output_args={"text": "Python and SQL skills.", "source_labels": ["SKILLS_1_NAME", "SKILLS_2_NAME"]})):
        assert handle_ai_task(task(sources), task_dependencies).status == "completed"
    assert len(seen) == 1
    assert "SQL" in seen[0] and "Python" in seen[0]
    assert "Previously approved fact" not in seen[0]


def test_sparse_education_does_not_supply_a_completion_claim(task_dependencies):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from agents.summary_generation_agent import summary_generation_agent
    seen = []
    def generate(messages, info):
        seen.extend(str(message) for message in messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "text": "Education in environmental science.", "source_labels": ["EDUCATIONS_1_DEGREE"]})])
    with summary_generation_agent.override(model=FunctionModel(generate)):
        result = handle_ai_task(task([{"label": "EDUCATIONS_1_DEGREE", "text": "Bachelor of Science, environmental science", "screened": True}]), task_dependencies)
    assert result.status == "completed"
    prompt = "\n".join(seen)
    assert "A named degree does not prove graduation or completion" in prompt
    assert "An end date alone is not" in prompt
    assert "Bachelor of Science, environmental science" in prompt


def test_saved_resume_target_uses_frozen_sources_and_screens_manual_edits(task_dependencies, monkeypatch):
    from agents.summary_generation_agent import summary_generation_agent
    from screening.screen_user_text import ScreenOutcome
    calls = []
    monkeypatch.setattr("worker.summary_generation_handler.screen_user_text",
        lambda text, **kwargs: (calls.append(text), ScreenOutcome(allowed=True))[1])
    message = task([
        {"label": "SECTION_1_ITEM_1_HIGHLIGHT_1", "text": "Previously generated billing APIs.", "screened": True},
        {"label": "SECTION_1_ITEM_1_TITLE", "text": "Manual role title", "screened": False},
    ])
    message.input["target_kind"] = "resume"
    with summary_generation_agent.override(model=TestModel(custom_output_args={
        "text": "Engineer who built billing APIs.", "source_labels": ["SECTION_1_ITEM_1_HIGHLIGHT_1"]})):
        result = handle_ai_task(message, task_dependencies)
    assert result.status == "completed"
    assert len(calls) == 1
    assert "Manual role title" in calls[0]
    assert "Previously generated billing APIs." not in calls[0]
