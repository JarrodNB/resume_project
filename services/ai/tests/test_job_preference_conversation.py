"""Exercise preference dialogue and saved provenance without live providers."""
from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task

pytestmark = pytest.mark.real_guardrail


def test_proposes_editable_criteria_without_confirmation(task_dependencies, monkeypatch):
    from agents.job_preference_conversation_agent import job_preference_conversation_agent
    from screening.screen_user_text import ScreenOutcome
    monkeypatch.setattr("worker.job_preference_conversation_handler.screen_user_text", lambda *_a, **_k: ScreenOutcome(True))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="elicit_job_preferences", input={
        "profile_version": 0, "criteria": [], "message": "I need remote work", "history": [], "turn": 1})
    with job_preference_conversation_agent.override(model=TestModel(call_tools=[], custom_output_args={
        "reply": "Review this draft.", "criteria": [{"text": "Remote work", "priority": "must_have"}]})):
        result = handle_ai_task(task, task_dependencies)
    assert result.status == "completed"
    assert result.result["criteria"] == [{"text": "Remote work", "priority": "must_have"}]
    assert result.message_history


def test_deferred_answer_reuses_private_history_and_does_not_rescreen_generated_text(task_dependencies, monkeypatch):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from agents.job_preference_conversation_agent import job_preference_conversation_agent
    from screening.screen_user_text import ScreenOutcome
    seen = []
    monkeypatch.setattr("worker.job_preference_conversation_handler.screen_user_text", lambda text, *_a, **_k: seen.append(text) or ScreenOutcome(True))
    first = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="elicit_job_preferences", input={
        "profile_version": 0, "criteria": [], "message": "Remote sounds good", "history": [], "turn": 1})
    def question(_messages, _info):
        return ModelResponse(parts=[ToolCallPart("ask_user", {"question": "Is remote work required or preferred?"}, tool_call_id="q-1")])
    with job_preference_conversation_agent.override(model=FunctionModel(question)):
        paused = handle_ai_task(first, task_dependencies)
    assert paused.status == "needs_user_input"
    assert paused.pending_questions[0]["id"] == "q-1"
    continuation = {**first.input, "message": "Required", "turn": 2, "previous_task_id": str(first.ai_task_id),
        "question_id": "q-1", "history": paused.message_history}
    with job_preference_conversation_agent.override(model=TestModel(call_tools=[], custom_output_args={
        "reply": "Review the draft.", "criteria": [{"text": "Remote work", "priority": "must_have"}]})):
        completed = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=first.user_id,
            task_type="elicit_job_preferences", input=continuation), task_dependencies)
    assert completed.status == "completed"
    assert seen == ["Remote sounds good", "Required"]


@pytest.mark.parametrize("unchecked", [False, True])
def test_blocked_or_unchecked_text_never_generates(task_dependencies, monkeypatch, unchecked):
    from screening.screen_user_text import ScreenOutcome
    monkeypatch.setattr("worker.job_preference_conversation_handler.screen_user_text", lambda *_a, **_k: ScreenOutcome(False, unchecked=unchecked))
    result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="elicit_job_preferences", input={
        "profile_version": 0, "criteria": [], "message": "Remote work", "history": [], "turn": 1}), task_dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert ("unavailable" in result.error_message) == unchecked


def test_exact_generated_criteria_are_trusted_but_manual_draft_is_screened(task_dependencies, monkeypatch):
    from agents.job_preference_conversation_agent import job_preference_conversation_agent
    from screening.screen_user_text import ScreenOutcome
    seen = []
    monkeypatch.setattr("worker.job_preference_conversation_handler.screen_user_text", lambda text, *_a, **_k: seen.append(text) or ScreenOutcome(True))
    payload = {"profile_version": 1, "criteria": [
        {"id": "one", "text": "Remote work", "priority": "must_have"},
        {"id": "two", "text": "Climate industry", "priority": "nice_to_have"}],
        "trusted_criteria": ["Remote work"], "message": "Keep these priorities", "history": [], "turn": 1}
    with job_preference_conversation_agent.override(model=TestModel(call_tools=[], custom_output_args={"reply": "Review", "criteria": []})):
        result = handle_ai_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="elicit_job_preferences", input=payload), task_dependencies)
    assert result.status == "completed"
    assert seen == ["Keep these priorities", "Climate industry"]


def test_history_requires_server_owned_previous_turn():
    from pydantic import ValidationError

    from schemas.job_preference_conversation import JobPreferenceConversationInput
    with pytest.raises(ValidationError, match="owned previous task"):
        JobPreferenceConversationInput(profile_version=0, message="Remote", turn=1,
            history=[{"kind": "response", "parts": []}])
