"""Check the guarded question-only queue path with synthetic providers and claim responses."""
from dataclasses import replace
from uuid import uuid4

import httpx
from pydantic_ai.models.test import TestModel

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def test_question_only_clarification(task_dependencies):
    from agents.interview_clarification_agent import interview_clarification_agent
    question = "What trade-off did you make?"
    calls = []

    def claim(request):
        calls.append(request)
        return httpx.Response(200, json={"allowed": True, "question_text": question})

    dependencies = replace(task_dependencies, settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test-secret"}), http_client=httpx.Client(transport=httpx.MockTransport(claim)),
        read_career_library=lambda _: (_ for _ in ()).throw(AssertionError("No library allowed")))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_clarification",
        input={"clarification_id": str(uuid4()), "question_text": question})
    with interview_clarification_agent.override(model=TestModel(custom_output_args={"explanation": "Explain which competing priorities you balanced and what you chose."})):
        result = handle_ai_task(task, dependencies)
    assert result.status == "completed"
    assert result.result == {"explanation": "Explain which competing priorities you balanced and what you chose."}
    assert len(calls) == 1
    assert len(result.usage) == 1


def test_blank_secret_fails_before_http_or_provider(task_dependencies):
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_clarification",
        input={"clarification_id": str(uuid4()), "question_text": "Describe a project."})
    def unexpected(request):
        raise AssertionError("No HTTP or model calls before configuration")
    deps = replace(task_dependencies, http_client=httpx.Client(transport=httpx.MockTransport(unexpected)))
    result = handle_ai_task(task, deps)
    assert result.status == "failed"
    assert not result.usage


def test_denied_duplicate_has_no_screening_or_generation(task_dependencies):
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_clarification",
        input={"clarification_id": str(uuid4()), "question_text": "Describe a project."})
    deps = replace(task_dependencies, settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test"}),
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"allowed": False}))))
    result = handle_ai_task(task, deps)
    assert result.status == "usage"
    assert result.result is None and not result.usage


def test_claimed_generated_question_reaches_explanation(task_dependencies):
    from agents.interview_clarification_agent import interview_clarification_agent

    question = "Describe a project."
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_clarification",
        input={"clarification_id": str(uuid4()), "question_text": question})
    deps = replace(task_dependencies, settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test"}),
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"allowed": True, "question_text": question}))))
    with interview_clarification_agent.override(model=TestModel(custom_output_args={"explanation": "Describe your choices."})):
        result = handle_ai_task(task, deps)
    assert result.status == "completed"
    assert len(result.usage) == 1


def test_provider_receives_fixed_instruction_and_exact_question_only(task_dependencies):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai.usage import RequestUsage

    from agents.interview_clarification_agent import interview_clarification_agent
    from prompts.interview_clarification_instructions import INTERVIEW_CLARIFICATION_INSTRUCTIONS
    observed = []
    question = "How did you test the scheduler?"
    def respond(messages, info):
        observed.extend(messages)
        assert info.model_settings["max_tokens"] == 1000
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"explanation": "Describe how you checked that the scheduler worked."})],
            model_name="gpt-6-luna", usage=RequestUsage(input_tokens=20, output_tokens=10))
    deps = replace(task_dependencies, settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test"}),
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"allowed": True, "question_text": question}))))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_clarification",
        input={"clarification_id": str(uuid4()), "question_text": question})
    with interview_clarification_agent.override(model=FunctionModel(respond)):
        assert handle_ai_task(task, deps).status == "completed"
    prompts = [part.content for message in observed for part in message.parts if part.part_kind == "user-prompt"]
    assert prompts == [question]
    assert observed[0].instructions == INTERVIEW_CLARIFICATION_INSTRUCTIONS


def test_extra_context_is_rejected_before_claim_or_generation(task_dependencies):
    import pytest
    from pydantic import ValidationError
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_clarification",
        input={"clarification_id": str(uuid4()), "question_text": "Describe a project.", "answer": "PRIVATE"})
    with pytest.raises(ValidationError):
        handle_ai_task(task, task_dependencies)


def test_denied_queue_delivery_finalizes_zero_cost_accounting(task_dependencies):
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message
    deps = replace(task_dependencies, settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test"}),
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"allowed": False}))))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_clarification",
        input={"clarification_id": str(uuid4()), "question_text": "Describe a project."})
    queue = FakeResultQueue()
    assert process_task_message(task.model_dump_json(), 2, queue, deps)
    from worker.queue_messages import AiResultMessage
    assert len(queue.sent_bodies) == 2
    marker, final = [AiResultMessage.model_validate_json(body) for body in queue.sent_bodies]
    assert marker.status == final.status == "usage"
    assert marker.attempt_id == final.attempt_id
    assert marker.attempt_finished is False and final.attempt_finished is True
    assert final.usage == [] and final.usage_incomplete is False


def test_claimed_provider_failure_requires_explicit_retry(task_dependencies, monkeypatch):
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message
    from worker.queue_messages import AiResultMessage
    question = "Describe a project."
    monkeypatch.setattr("worker.interview_clarification_handler.generate_interview_clarification",
        lambda *a, **kw: (_ for _ in ()).throw(TimeoutError("provider timeout")))
    deps = replace(task_dependencies, settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test"}),
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"allowed": True, "question_text": question}))))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_clarification",
        input={"clarification_id": str(uuid4()), "question_text": question})
    queue = FakeResultQueue()
    assert process_task_message(task.model_dump_json(), 1, queue, deps)
    final = AiResultMessage.model_validate_json(queue.sent_bodies[-1])
    assert final.status == "failed"
    assert final.attempt_finished is True
