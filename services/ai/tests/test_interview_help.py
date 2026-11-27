"""Check shared claim rules through dispatch and queue processing with offline seams.

Controlled HTTP and owned-context readers verify that denied, stale and ambiguous
claims stop before paid work, while retaining the normal queue accounting lifecycle.
"""
from contextlib import ExitStack
from dataclasses import replace
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError
from pydantic_ai.models.test import TestModel

from agents.interview_clarification_agent import interview_clarification_agent
from agents.interview_session_feedback_agent import interview_session_feedback_agent
from llm.usage import accounted_model, collect_task_usage
from schemas.gap_analysis_context import CareerLibrary
from tests.test_process_task_message import FakeResultQueue
from worker.main import process_task_message
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_handlers import handle_ai_task


@pytest.fixture(params=[
    ("interview_clarification", "clarification_id", "clarifications", "Question changed"),
    ("interview_references", "reference_id", "references", "Question changed"),
    ("interview_session_feedback", "feedback_id", "feedback",
     "Saved interview feedback context is invalid"),
])
def help_attempt(request):
    kind, key, path, context_error = request.param
    task = AiTaskMessage(
        ai_task_id=uuid4(), user_id=uuid4(), task_type=kind, input={key: str(uuid4())},
    )
    return task, path, context_error


def dependencies_with_claim(task_dependencies, respond, reader):
    return replace(
        task_dependencies,
        settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test"}),
        http_client=httpx.Client(transport=httpx.MockTransport(respond)),
        read_interview_auxiliary=reader,
    )


def test_invalid_command_never_claims(help_attempt, task_dependencies):
    task, _, _ = help_attempt
    task.input["draft_answer"] = "Must not enter the claim"
    http = Mock(side_effect=AssertionError("Must validate before claiming"))
    deps = dependencies_with_claim(task_dependencies, http, Mock())
    with pytest.raises(ValidationError):
        handle_ai_task(task, deps)
    http.assert_not_called()


def test_missing_configuration_never_claims(help_attempt, task_dependencies):
    task, _, _ = help_attempt
    http = Mock(side_effect=AssertionError("Must not claim without a secret"))
    reader = Mock(side_effect=AssertionError("Must not read without a claim"))
    deps = dependencies_with_claim(task_dependencies, http, reader)
    deps = replace(deps, settings=deps.settings.model_copy(update={"interview_service_secret": "  "}))
    result = handle_ai_task(task, deps)
    assert result.status == "failed" and result.usage == []
    assert result.error_message.endswith("not configured")
    http.assert_not_called()
    reader.assert_not_called()


def test_denied_claim_finalizes_zero_usage_without_loading_sources(help_attempt, task_dependencies):
    task, path, _ = help_attempt
    reader = Mock(side_effect=AssertionError("Denied claim cannot load context"))

    def deny(request):
        assert request.method == "POST"
        assert request.url.path == f"/internal/interviews/{path}/{task.ai_task_id}/claim"
        assert request.headers["Authorization"] == "Bearer test"
        return httpx.Response(200, json={"allowed": False})

    deps = dependencies_with_claim(task_dependencies, deny, reader)
    queue = FakeResultQueue()
    assert process_task_message(task.model_dump_json(), 2, queue, deps)
    marker, final = [AiResultMessage.model_validate_json(body) for body in queue.sent_bodies]
    assert marker.attempt_id == final.attempt_id
    assert marker.status == final.status == "usage"
    assert not marker.attempt_finished and final.attempt_finished
    assert not final.usage_incomplete and final.usage == [] and final.result is None
    reader.assert_not_called()


def test_admitted_work_uses_owned_context_from_identity_only_claim(help_attempt, task_dependencies):
    task, _, _ = help_attempt
    question_id = str(uuid4())
    grant = {"allowed": True, "record_id": str(uuid4()), "interview_id": str(uuid4()),
             "claimed_at": "2026-11-03T00:00:00Z"}
    saved = {
        "question_text": "Describe a project.", "query_text": "Describe a project.",
        "questions": [{"question_id": question_id, "question": "Describe a project.",
                       "dialogue": [{"kind": "answer", "content": "I planned a workshop."}]}],
    }
    reader = Mock(return_value=saved)
    deps = dependencies_with_claim(
        task_dependencies, lambda _: httpx.Response(200, json=grant), reader,
    )
    deps = replace(deps, read_career_library=lambda _: CareerLibrary())
    explanation = {"explanation": "Describe what you worked on and what you did."}
    feedback = {"summary": "You described your work.", "questions": [{
        "question_id": question_id, "strengths": ["You gave an action."],
        "improvements": ["Add the outcome."], "example_answer": "I planned a workshop.",
    }]}
    with ExitStack() as stack:
        usage = stack.enter_context(collect_task_usage())
        stack.enter_context(interview_clarification_agent.override(
            model=accounted_model(TestModel(custom_output_args=explanation)),
        ))
        stack.enter_context(interview_session_feedback_agent.override(
            model=accounted_model(TestModel(custom_output_args=feedback)),
        ))
        result = handle_ai_task(task, deps)
    assert result.status == "completed"
    if task.task_type == "interview_clarification":
        assert result.result == explanation and len(usage.entries) == 1
    elif task.task_type == "interview_session_feedback":
        assert result.result == {"interview_session_feedback": feedback} and len(usage.entries) == 1
    else:
        assert result.result["references"] == [] and usage.entries == []
    reader.assert_called_once_with(task, grant)


@pytest.mark.parametrize("source_error", [ValueError, KeyError])
def test_stale_context_fails_after_identity_only_claim(help_attempt, task_dependencies, source_error):
    task, _, context_error = help_attempt
    grant = {"allowed": True, "record_id": str(uuid4()), "interview_id": str(uuid4()),
             "claimed_at": "2026-11-03T00:00:00Z"}
    reader = Mock(side_effect=source_error("Saved claim no longer matches"))
    deps = dependencies_with_claim(
        task_dependencies, lambda _: httpx.Response(200, json=grant), reader,
    )
    result = handle_ai_task(task, deps)
    assert result.status == "failed" and result.error_message == context_error
    assert result.usage == [] and result.result is None
    reader.assert_called_once_with(task, grant)


@pytest.mark.parametrize("failure", ["timeout", "server_error"])
def test_ambiguous_claim_needs_explicit_retry(help_attempt, task_dependencies, failure):
    task, _, _ = help_attempt
    reader = Mock(side_effect=AssertionError("Failed claim cannot load context"))

    def fail(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("Claim receipt lost", request=request)
        return httpx.Response(503)

    deps = dependencies_with_claim(task_dependencies, fail, reader)
    queue = FakeResultQueue()
    assert process_task_message(task.model_dump_json(), 1, queue, deps)
    marker, final = [AiResultMessage.model_validate_json(body) for body in queue.sent_bodies]
    assert marker.attempt_id == final.attempt_id
    assert final.status == "failed" and final.attempt_finished
    assert final.usage == [] and not final.usage_incomplete
    reader.assert_not_called()
