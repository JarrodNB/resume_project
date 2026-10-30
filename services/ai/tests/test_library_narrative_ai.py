"""Review and improve each new narrative target through the real offline task interface."""

from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel

from screening.screen_user_text import ScreenOutcome
from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def patch_edit_screen(monkeypatch, screen):
    """Library edits screen saved records through screening.records and notes directly."""
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", screen)
    monkeypatch.setattr("screening.records.screen_user_text", screen)


def narrative_input(section):
    if section == "summary":
        library = {"summary_record_id": "user-1", "summary": "I build useful tools.", "screened_fields": ["summary"]}
        kind, field, content = "user", "summary", library["summary"]
        record_id = "user-1"
    elif section == "projects":
        library = {"projects": [{"id": "project-1", "name": "Stock sheet", "role": "Contributor",
                                  "description": "Created a shared inventory sheet.", "screened_fields": ["name", "role", "description"]}]}
        kind, field, content, record_id = "project", "description", library["projects"][0]["description"], "project-1"
    else:
        library = {"career_contexts": [{"id": "fact-1", "requirement": "Inventory experience", "response": "I maintained the count sheet.",
                              "screened_fields": ["requirement", "response"]}]}
        kind, field, content, record_id = "career_context", "response", library["career_contexts"][0]["response"], "fact-1"
    target = {"kind": kind, "field": field, "record_id": record_id, "source_digest": "a" * 64, "label": "T1"}
    return {"section": section, "library": library, "targets": [target], "target": target,
            "original_text": content, "feedback": "Keep the facts and clarify the wording", "turn": 1}


@pytest.mark.parametrize("section", ["summary", "projects", "career_contexts"])
def test_section_review_and_individual_proposal_reuse_coverage(section, task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from agents.library_review_agent import library_review_agent

    screened = []
    def check(text, *_args, **_kwargs):
        screened.append(text)
        return ScreenOutcome(True)
    patch_edit_screen(monkeypatch, check)
    async def unexpected(*_args, **_kwargs):
        raise AssertionError("Generated text and covered saved fields must not be classified")
    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", unexpected)

    payload = narrative_input(section)
    with library_review_agent.override(model=TestModel(custom_output_args={"assessments": [
        {"target_label": "T1", "color": "yellow", "reason": "Clarify the specific contribution."},
    ]})):
        reviewed = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(),
            task_type="review_library_section", input=payload), task_dependencies)
    assert reviewed.status == "completed"
    assert reviewed.result["assessments"][0]["record_id"] == payload["target"]["record_id"]
    assert screened == []
    with library_edit_agent.override(model=TestModel(call_tools=[], custom_output_args={
        "text": "Clearer wording using only the supplied facts.", "color": "yellow", "reason": "Add the outcome if known.",
    })):
        edited = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(),
            task_type="improve_library_entry", input=payload), task_dependencies)
    assert edited.status == "completed"
    assert screened == [payload["feedback"]]


@pytest.mark.parametrize("section", ["summary", "projects", "career_contexts"])
def test_other_sections_cannot_hitchhike_into_narrative_review(section, task_dependencies):
    payload = narrative_input(section)
    payload["library"]["skills"] = [{"id": "skill-1", "name": "Unrelated text"}]
    with pytest.raises(ValueError, match="selected section"):
        handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(),
            task_type="review_library_section", input=payload), task_dependencies)
