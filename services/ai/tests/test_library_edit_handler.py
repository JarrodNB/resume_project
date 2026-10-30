"""Exercise individual regeneration, deferred questions, and user-only screening offline."""

from uuid import uuid4

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from tests.test_library_review_handler import review_input
from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task

pytestmark = pytest.mark.real_guardrail


def edit_input():
    payload = review_input()
    payload.update(target=payload["targets"][1], original_text="Helped with migration", feedback="Make this clearer", history=[], root_id=str(uuid4()), turn=1, skip=False)
    return payload


def test_generates_one_proposal_without_changing_its_target(task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from screening.screen_user_text import ScreenOutcome
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(True))

    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=edit_input())
    with library_edit_agent.override(model=TestModel(call_tools=[], custom_output_args={
        "text": "Contributed to the service migration.", "color": "yellow", "reason": "The contribution could be more specific.",
    })):
        result = handle_ai_task(task, task_dependencies)
    assert result.status == "completed"
    assert result.result["text"] == "Contributed to the service migration."
    assert result.message_history


def test_deferred_answer_screens_only_new_user_text_not_generated_history(task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from screening.screen_user_text import ScreenOutcome

    screened = []
    def screen(text, *_args, **_kwargs):
        screened.append(text)
        return ScreenOutcome(True)
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", screen)
    async def unexpected(*_args, **_kwargs):
        raise AssertionError("Saved generated history must not be sent to the generic classifier")
    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", unexpected)

    first = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=edit_input())
    def question(_messages, _info):
        return ModelResponse(parts=[ToolCallPart("ask_user", {"question": "Which part did you handle?"}, tool_call_id="question-1")])
    with library_edit_agent.override(model=FunctionModel(question)):
        paused = handle_ai_task(first, task_dependencies)
    assert paused.status == "needs_user_input"
    assert paused.pending_questions == [{"id": "question-1", "question": "Which part did you handle?"}]

    followup = {**first.input, "history": paused.message_history, "previous_task_id": str(first.ai_task_id), "turn": 2,
                "question_id": "question-1", "feedback": "I migrated the billing API; I did not lead the team."}
    def proposal(messages, info):
        rendered = str(messages)
        assert "I did not lead the team" in rendered
        answer = next(part.content for message in messages for part in message.parts
                      if isinstance(part, ToolReturnPart) and part.tool_name == "ask_user")
        assert answer == "<user_answer>\nI migrated the billing API; I did not lead the team.\n</user_answer>"
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "text": "Migrated the billing API as part of the platform team.", "color": "yellow", "reason": "Add an outcome if known.",
        })])
    with library_edit_agent.override(model=FunctionModel(proposal)):
        completed = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=first.user_id,
            task_type="improve_library_entry", input=followup), task_dependencies)
    assert completed.status == "completed"
    assert screened == ["Make this clearer", "I migrated the billing API; I did not lead the team."]

    # A normal feedback turn after a completed draft also reuses its saved history.
    followup.update(history=completed.message_history, previous_task_id=str(uuid4()), turn=3,
                    question_id=None, feedback="Keep the technical detail")
    with library_edit_agent.override(model=TestModel(call_tools=[], custom_output_args={
        "text": "Migrated the billing API with the platform team.", "color": "yellow", "reason": "Outcome remains unknown.",
    })):
        revised = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=first.user_id,
            task_type="improve_library_entry", input=followup), task_dependencies)
    assert revised.status == "completed"
    assert screened[-1] == "Keep the technical detail"
    assert len(screened) == 3


@pytest.mark.parametrize("unchecked", [False, True])
def test_blocked_or_unavailable_user_message_stops_before_generation(task_dependencies, monkeypatch, unchecked):
    from screening.screen_user_text import ScreenOutcome
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(False, unchecked=unchecked))
    result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=edit_input()), task_dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert ("unavailable" in result.error_message) == unchecked


def test_skipping_a_saved_question_does_not_screen_generated_question_or_skip_note(task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from screening.screen_user_text import ScreenOutcome
    screened = []
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda text, *_args, **_kwargs: screened.append(text) or ScreenOutcome(True))
    def question(_messages, _info):
        return ModelResponse(parts=[ToolCallPart("ask_user", {"question": "What changed afterward?"}, tool_call_id="q-skip")])
    first = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=edit_input())
    with library_edit_agent.override(model=FunctionModel(question)):
        paused = handle_ai_task(first, task_dependencies)
    followup = {**first.input, "history": paused.message_history, "previous_task_id": str(first.ai_task_id), "turn": 2,
                "question_id": "q-skip", "feedback": "", "skip": True}
    with library_edit_agent.override(model=TestModel(call_tools=[], custom_output_args={
        "text": "Contributed to the service migration.", "color": "yellow", "reason": "Outcome is not known.",
    })):
        result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=first.user_id, task_type="improve_library_entry", input=followup), task_dependencies)
    assert result.status == "completed"
    assert screened == ["Make this clearer"]


def test_history_limit_preserves_consumed_model_usage(task_dependencies, monkeypatch):
    from pydantic_ai.usage import RunUsage

    from agents.library_edit_agent import LibraryEditRun
    from schemas.library_edit import LibraryEditDraft
    from screening.screen_user_text import ScreenOutcome
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(True))
    monkeypatch.setattr("worker.library_edit_handler.improve_library_entry", lambda *_args: LibraryEditRun(
        LibraryEditDraft(text="Contributed to migration.", color="yellow", reason="Add detail."),
        [{"content": "x" * 100_001}], RunUsage(input_tokens=20, output_tokens=10), "openai:gpt-6-luna"))
    result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=edit_input()), task_dependencies)
    assert result.status == "failed"
    assert result.usage[0].input_tokens == 20


def test_registered_edit_agent_masks_known_contact_in_source_and_feedback(task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from privacy.contact_mask import contact_scope, install_contact_hooks
    from privacy.known_contact import KnownContact
    from screening.screen_user_text import ScreenOutcome
    install_contact_hooks()
    screened = []
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda text, *_args, **_kwargs: screened.append(text) or ScreenOutcome(True))
    payload = edit_input()
    payload["feedback"] = "Jane Doe wants clearer wording"
    payload["library"]["experiences"][0]["description"] = "Jane Doe built services"
    def proposal(messages, info):
        assert "Jane Doe" not in str(messages)
        assert "«name»" in str(messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"text": "Contributed to migration.", "color": "yellow", "reason": "Add detail."})])
    with contact_scope(KnownContact.from_values(names=["Jane Doe"])), library_edit_agent.override(model=FunctionModel(proposal)):
        result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=payload), task_dependencies)
    assert result.status == "completed"
    assert screened == ["«name» wants clearer wording"]


def test_review_answer_regenerates_without_pausing_or_screening_the_generated_question(task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from screening.screen_user_text import ScreenOutcome

    screened = []
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda text, *_args, **_kwargs: screened.append(text) or ScreenOutcome(True))
    async def unexpected(*_args, **_kwargs):
        raise AssertionError("Prepared source, answer, and generated question must already be covered")
    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", unexpected)
    payload = edit_input()
    payload["feedback"] = "I migrated the billing endpoints; the outcome is unknown."
    payload["review_question"] = {"review_task_id": str(uuid4()), "question": "Which endpoints did you migrate?"}
    def proposal(messages, info):
        rendered = str(messages)
        assert "Which endpoints did you migrate?" in rendered
        assert payload["feedback"] in rendered
        assert payload["review_question"]["review_task_id"] not in rendered
        if "Further questions are disabled" not in rendered:
            return ModelResponse(parts=[ToolCallPart("ask_user", {"question": "What was the outcome?"}, tool_call_id="unneeded")])
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "text": "Migrated the billing endpoints as part of the service migration.", "color": "yellow", "reason": "The outcome remains unknown.",
        })])
    with library_edit_agent.override(model=FunctionModel(proposal)):
        result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=payload), task_dependencies)
    assert result.status == "completed"
    assert result.pending_questions == []
    assert screened == [payload["feedback"]]


def test_review_answer_tool_attempt_cannot_pause_the_regeneration(task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from screening.screen_user_text import ScreenOutcome
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(True))
    payload = edit_input()
    payload["review_question"] = {"review_task_id": str(uuid4()), "question": "Which part did you handle?"}
    calls = []
    def proposal(messages, info):
        calls.append(messages)
        if len(calls) == 1:
            return ModelResponse(parts=[ToolCallPart("ask_user", {"question": "Can you add more?"}, tool_call_id="unneeded")])
        assert "Further questions are disabled" in str(messages[-1])
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"text": "Contributed to migration.", "color": "yellow", "reason": "Unknown outcomes remain unknown."})])
    with library_edit_agent.override(model=FunctionModel(proposal)):
        result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=payload), task_dependencies)
    assert result.status == "completed"
    assert result.pending_questions == []
    assert len(calls) == 2


def test_partial_review_batch_preserves_question_indices_and_screens_only_answered_facts(task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from screening.screen_user_text import ScreenOutcome

    screened = []
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda text, *_args, **_kwargs: screened.append(text) or ScreenOutcome(True))
    async def unexpected(*_args, **_kwargs):
        raise AssertionError("Saved questions and screened answer fields must already have coverage")
    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", unexpected)
    payload = edit_input()
    payload["feedback"] = ""
    payload["review_question"] = {"review_task_id": str(uuid4()), "answers": [
        {"question_index": 1, "question": "How did you check it?", "answer": "I updated integration tests."},
        {"question_index": 2, "question": "What changed afterward?", "answer": "Colleagues could find billing records."},
    ]}
    def proposal(messages, info):
        rendered = str(messages)
        assert "Review question 2" in rendered and "User answer 2" in rendered
        assert "Review question 3" in rendered and "User answer 3" in rendered
        assert "How did you check it?" in rendered and "I updated integration tests." in rendered
        assert "What changed afterward?" in rendered and "Colleagues could find billing records." in rendered
        assert "Review question 1" not in rendered
        assert payload["review_question"]["review_task_id"] not in rendered
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "text": "Updated integration tests so colleagues could find billing records.", "color": "green", "reason": "Specific work and result.",
        })])
    with library_edit_agent.override(model=FunctionModel(proposal)):
        result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=payload), task_dependencies)
    assert result.status == "completed"
    assert result.pending_questions == []
    assert screened == [item["answer"] for item in payload["review_question"]["answers"]]


def test_review_batch_followup_reuses_checked_history_and_screens_only_new_feedback(task_dependencies, monkeypatch):
    from agents.library_edit_agent import library_edit_agent
    from screening.screen_user_text import ScreenOutcome
    screened = []
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda text, *_args, **_kwargs: screened.append(text) or ScreenOutcome(True))
    payload = edit_input()
    payload.update(feedback="", review_question={"review_task_id": str(uuid4()), "answers": [
        {"question_index": 0, "question": "What did you change?", "answer": "I migrated billing endpoints."},
        {"question_index": 2, "question": "What changed afterward?", "answer": "Reconciliation became easier."},
    ]})
    first_id = uuid4()
    with library_edit_agent.override(model=TestModel(call_tools=[], custom_output_args={"text": "Migrated billing endpoints for easier reconciliation.", "color": "green", "reason": "Concrete action and result."})):
        first = handle_ai_task(AiTaskMessage(ai_task_id=first_id, user_id=uuid4(), task_type="improve_library_entry", input=payload), task_dependencies)
    assert first.status == "completed"
    payload.update(previous_task_id=str(first_id), history=first.message_history, turn=2, feedback="Keep both facts concise.")
    def revised(messages, info):
        assert "I migrated billing endpoints." in str(messages)
        assert "Reconciliation became easier." in str(messages)
        assert "Keep both facts concise." in str(messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"text": "Migrated billing endpoints, simplifying reconciliation.", "color": "green", "reason": "Preserves both facts."})])
    with library_edit_agent.override(model=FunctionModel(revised)):
        result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=payload), task_dependencies)
    assert result.status == "completed"
    assert screened == ["I migrated billing endpoints.", "Reconciliation became easier.", "Keep both facts concise."]


def test_blocked_batch_answer_stops_before_generation(task_dependencies, monkeypatch):
    from screening.screen_user_text import ScreenOutcome
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(False))
    payload = edit_input()
    payload.update(feedback="", review_question={"review_task_id": str(uuid4()), "answers": [
        {"question_index": 1, "question": "How did you check it?", "answer": "Blocked user input."},
    ]})
    monkeypatch.setattr("worker.library_edit_handler.improve_library_entry", lambda *_args: pytest.fail("Blocked answers must not reach the writer"))
    result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=payload), task_dependencies)
    assert result.status == "failed"
    assert result.result is None


@pytest.mark.parametrize("answers", [[], [
    {"question_index": 1, "question": "Which part?", "answer": "A"},
    {"question_index": 1, "question": "Which part?", "answer": "B"},
], [{"question_index": 3, "question": "Which part?", "answer": "A"}],
    [{"question_index": 0, "question": "Which part?", "answer": " "}],
    [{"question_index": 0, "question": "Which part?", "answer": "x" * 4001}]])
def test_malformed_saved_review_batches_are_rejected(answers):
    from pydantic import ValidationError

    from schemas.library_edit import LibraryEditInput
    payload = edit_input()
    payload.update(feedback="", review_question={"review_task_id": str(uuid4()), "answers": answers})
    with pytest.raises(ValidationError):
        LibraryEditInput.model_validate(payload)
