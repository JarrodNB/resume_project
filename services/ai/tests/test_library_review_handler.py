"""Exercise section review at the queued handler, with real offline agent execution."""

from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task

pytestmark = pytest.mark.real_guardrail


def review_input():
    return {
        "section": "experience",
        "library": {"experiences": [{
            "id": "role-1", "company": "Acme", "title": "Engineer",
            "description": "Built services", "screened_fields": ["company", "title", "description"],
            "highlights": [{"id": "bullet-1", "content": "Helped with migration", "screened_fields": ["content"]}],
        }]},
        "targets": [
            {"label": "T1", "kind": "experience", "record_id": "role-1", "field": "description", "source_digest": "a" * 64},
            {"label": "T2", "kind": "experience_highlight", "record_id": "bullet-1", "field": "content", "source_digest": "b" * 64},
        ],
    }


def test_reviews_only_selected_targets_with_traffic_lights(task_dependencies):
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section", input=review_input())
    from agents.library_review_agent import library_review_agent

    with library_review_agent.override(model=TestModel(custom_output_args={"assessments": [
        {"target_label": "T1", "color": "yellow", "reason": "Explain what the services did."},
        {"target_label": "T2", "color": "red", "reason": "Describe your contribution to the migration.",
         "questions": ["What did you personally do during the migration?", "How did you approach that work?", "What changed afterward, if anything?"]},
    ]})):
        result = handle_ai_task(task, task_dependencies)

    assert result.status == "completed"
    assert [(item["record_id"], item["color"]) for item in result.result["assessments"]] == [
        ("role-1", "yellow"), ("bullet-1", "red"),
    ]
    assert result.result["assessments"][1]["source_digest"] == "b" * 64
    assert result.result["assessments"][1]["question"] == "What did you personally do during the migration?"
    assert result.result["assessments"][1]["questions"] == [
        "What did you personally do during the migration?", "How did you approach that work?", "What changed afterward, if anything?",
    ]
    assert result.result["assessments"][0].get("question") is None
    assert result.usage


def test_screening_covers_only_unchecked_source_not_generated_output(task_dependencies, monkeypatch):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai.usage import RunUsage

    from agents.library_review_agent import library_review_agent
    from agents.user_text_screen_agent import user_text_screen_agent
    from screening.session import screening_session

    seen = []
    def classify(messages, info):
        seen.append(messages[-1].parts[-1].content)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "prompt_injection": False, "harmful_request": False,
        })], model_name="jev-1.13.0", usage=RunUsage(input_tokens=5),
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    payload = review_input()
    payload["library"]["experiences"][0]["highlights"][0]["screened_fields"] = []
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section", input=payload)
    with screening_session() as session, user_text_screen_agent.override(model=FunctionModel(classify)), library_review_agent.override(model=TestModel(custom_output_args={"assessments": [
        {"target_label": "T1", "color": "yellow", "reason": "Generated advice one."},
        {"target_label": "T2", "color": "red", "reason": "Generated advice two."},
    ]})):
        result = handle_ai_task(task, task_dependencies)
        assert [(report.record_type, report.fields) for report in session.library_screening] == [("experience_highlight", ["content"])]
    assert result.status == "completed"
    assert len(seen) == 1
    assert "Helped with migration" in seen[0]
    assert "Built services" not in seen[0]
    assert "Generated advice" not in seen[0]
    assert "Review these" not in seen[0]


def test_blocked_source_stops_before_generation(task_dependencies, monkeypatch):
    from agents.library_review_agent import library_review_agent
    from screening.screen_user_text import ScreenOutcome
    payload = review_input()
    payload["library"]["experiences"][0]["screened_fields"] = []
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section", input=payload)
    monkeypatch.setattr("worker.library_review_handler.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(False))
    with library_review_agent.override(model=TestModel()):
        result = handle_ai_task(task, task_dependencies)
    assert result.status == "failed"
    assert "safety check" in result.error_message
    assert result.result is None


@pytest.mark.parametrize("question", ["", "   ", "x" * 501, 123, ["What did you do?"]])
def test_rejects_malformed_generated_questions(task_dependencies, question):
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    from agents.library_review_agent import library_review_agent

    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section", input=review_input())
    with library_review_agent.override(model=TestModel(custom_output_args={"assessments": [
        {"target_label": "T1", "color": "yellow", "reason": "Clarify scope.", "question": question},
        {"target_label": "T2", "color": "red", "reason": "Clarify contribution."},
    ]})), pytest.raises(UnexpectedModelBehavior):
        handle_ai_task(task, task_dependencies)


@pytest.mark.parametrize("questions", [
    ["One?", "Two?", "Three?", "Four?"], [""], ["   "], ["x" * 501],
    [123], "What did you do?", ["What did you do?", " WHAT  did you do? "],
])
def test_rejects_malformed_or_repeated_question_sets(task_dependencies, questions):
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    from agents.library_review_agent import library_review_agent

    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section", input=review_input())
    with library_review_agent.override(model=TestModel(custom_output_args={"assessments": [
        {"target_label": "T1", "color": "yellow", "reason": "Clarify scope.", "questions": questions},
        {"target_label": "T2", "color": "red", "reason": "Clarify contribution."},
    ]})), pytest.raises(UnexpectedModelBehavior):
        handle_ai_task(task, task_dependencies)


def test_legacy_single_question_remains_a_one_item_set(task_dependencies):
    from agents.library_review_agent import library_review_agent

    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section", input=review_input())
    with library_review_agent.override(model=TestModel(custom_output_args={"assessments": [
        {"target_label": "T1", "color": "yellow", "reason": "Clarify scope.", "question": "Which services?"},
        {"target_label": "T2", "color": "red", "reason": "Clarify contribution."},
    ]})):
        result = handle_ai_task(task, task_dependencies)
    assert result.result["assessments"][0]["questions"] == ["Which services?"]
    assert result.result["assessments"][1]["questions"] == []


def test_rejects_disagreeing_scalar_and_array_questions(task_dependencies):
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    from agents.library_review_agent import library_review_agent

    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section", input=review_input())
    with library_review_agent.override(model=TestModel(custom_output_args={"assessments": [
        {"target_label": "T1", "color": "yellow", "reason": "Clarify scope.", "questions": ["Which services?"], "question": "Another question?"},
        {"target_label": "T2", "color": "red", "reason": "Clarify contribution."},
    ]})), pytest.raises(UnexpectedModelBehavior):
        handle_ai_task(task, task_dependencies)


def test_oversized_section_fails_without_model_or_screen_calls(task_dependencies, monkeypatch):
    payload = review_input()
    payload["library"]["experiences"][0]["description"] = "x" * 80_001
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section", input=payload)
    def unexpected(*args, **kwargs):
        raise AssertionError("Oversized section must fail before model work")
    monkeypatch.setattr("worker.library_review_handler.screen_user_text", unexpected)
    result = handle_ai_task(task, task_dependencies)
    assert result.status == "failed" and "too long" in result.error_message
