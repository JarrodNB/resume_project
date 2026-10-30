"""Completed-session coaching uses authoritative saved text and once-only Rails claims."""
from dataclasses import replace
from uuid import uuid4

import httpx
from pydantic_ai.models.test import TestModel

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def test_completed_session_returns_saved_question_coaching(task_dependencies):
    question_id = str(uuid4())
    request = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_session_feedback",
        input={"feedback_id": str(uuid4())})
    grant = {"allowed": True, "role": {"title": "Coordinator", "responsibilities": ["Plan workshops"], "requirements": []},
        "setup": {}, "questions": [{"question_id": question_id, "question": "Describe a challenge.",
        "dialogue": [{"kind": "answer", "content": "I organized a workshop."},
                     {"kind": "follow_up", "content": "What happened?"},
                     {"kind": "answer", "content": "My peers attended."}]}]}
    calls = []
    def claim(http_request):
        calls.append(http_request)
        return httpx.Response(200, json=grant)
    dependencies = replace(task_dependencies,
        settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test-secret", "llm_run_timeout_seconds": 5}),
        http_client=httpx.Client(transport=httpx.MockTransport(claim)))
    output = {"summary": "You explained an action; make the result clearer.", "questions": [{"question_id": question_id,
        "strengths": ["You gave a concrete action."], "improvements": ["Explain what peers learned."],
        "example_answer": "I organized a workshop that my peers attended. [Add the actual learning outcome.]"}]}
    from agents.interview_session_feedback_agent import interview_session_feedback_agent
    with interview_session_feedback_agent.override(model=TestModel(custom_output_args=output)):
        result = handle_ai_task(request, dependencies)
    assert result.status == "completed"
    assert result.result == {"interview_session_feedback": output}
    assert len(result.usage) == 1
    assert calls[0].url.path == f"/internal/interviews/feedback/{request.ai_task_id}/claim"
    assert calls[0].headers["Authorization"] == "Bearer test-secret"


def request_and_dependencies(task_dependencies, grant):
    request = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="interview_session_feedback",
        input={"feedback_id": str(uuid4())})
    dependencies = replace(task_dependencies,
        settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test", "llm_run_timeout_seconds": 5}),
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=grant))))
    return request, dependencies


def saved_grant():
    return {"allowed": True, "role": {}, "questions": [{"question_id": str(uuid4()),
        "question": "Describe a project.", "dialogue": [{"kind": "answer", "content": "I planned a workshop."}]}]}


def coaching(question_id):
    return {"summary": "You identified your contribution.", "questions": [{"question_id": question_id,
        "strengths": ["You identify an action."], "improvements": ["Add the actual outcome."],
        "example_answer": "I planned a workshop. [Add the actual outcome.]"}]}


def test_duplicate_claim_performs_no_generation(task_dependencies):
    request, dependencies = request_and_dependencies(task_dependencies, {"allowed": False})
    result = handle_ai_task(request, dependencies)
    assert result.status == "usage" and result.usage == [] and result.result is None


def test_unanswered_claim_fails_before_provider(task_dependencies):
    grant = saved_grant()
    grant["questions"][0]["dialogue"] = [{"kind": "follow_up", "content": "Can you give an example?"}]
    request, dependencies = request_and_dependencies(task_dependencies, grant)
    result = handle_ai_task(request, dependencies)
    assert result.status == "failed" and not result.usage


def test_unknown_question_id_is_rejected_with_generation_usage(task_dependencies):
    from agents.interview_session_feedback_agent import interview_session_feedback_agent
    request, dependencies = request_and_dependencies(task_dependencies, saved_grant())
    with interview_session_feedback_agent.override(model=TestModel(custom_output_args=coaching(str(uuid4())))):
        result = handle_ai_task(request, dependencies)
    assert result.status == "failed"
    assert result.usage and result.usage[0].input_tokens > 0
    assert result.result is None


def test_blank_summary_is_rejected(task_dependencies):
    from agents.interview_session_feedback_agent import interview_session_feedback_agent
    grant = saved_grant()
    output = coaching(grant["questions"][0]["question_id"])
    output["summary"] = "   "
    request, dependencies = request_and_dependencies(task_dependencies, grant)
    with interview_session_feedback_agent.override(model=TestModel(custom_output_args=output)):
        assert handle_ai_task(request, dependencies).status == "failed"


def test_prompt_contains_readable_dialogue_and_reuses_screening(task_dependencies, monkeypatch):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai.usage import RequestUsage

    from agents.interview_session_feedback_agent import interview_session_feedback_agent
    grant = saved_grant()
    grant["questions"][0]["dialogue"] += [{"kind": "follow_up", "content": "What changed?"},
        {"kind": "answer", "content": "My peers attended."}]
    request, dependencies = request_and_dependencies(task_dependencies, grant)
    def no_screen(*args, **kwargs):
        raise AssertionError("Previously accepted dialogue must not be screened again")
    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", no_screen)
    async def respond(messages, info):
        prompt = messages[-1].parts[-1].content
        assert "Accepted answer: I planned a workshop." in prompt
        assert "Interviewer follow-up: What changed?" in prompt
        assert "Accepted answer: My peers attended." in prompt
        assert '"dialogue":' not in prompt and '"questions":' not in prompt
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            coaching(grant["questions"][0]["question_id"]))],
            usage=RequestUsage(input_tokens=50, output_tokens=25), model_name="gpt-6-luna")
    with interview_session_feedback_agent.override(model=FunctionModel(respond)):
        assert handle_ai_task(request, dependencies).status == "completed"


def test_provider_timeout_finalizes_failure_without_automatic_retry(task_dependencies, monkeypatch):
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message
    from worker.queue_messages import AiResultMessage
    request, dependencies = request_and_dependencies(task_dependencies, saved_grant())
    def fail(*args, **kwargs):
        raise TimeoutError("Provider timed out")
    monkeypatch.setattr("worker.interview_session_feedback_handler.generate_interview_session_feedback", fail)
    queue = FakeResultQueue()
    assert process_task_message(request.model_dump_json(), 1, queue, dependencies)
    final = AiResultMessage.model_validate_json(queue.sent_bodies[-1])
    assert final.status == "failed" and final.attempt_finished


def test_oversized_aggregate_coaching_is_rejected(task_dependencies):
    from agents.interview_session_feedback_agent import interview_session_feedback_agent
    grant = saved_grant()
    # Each record must be independent and uniquely identified.
    grant["questions"] = [{**saved_grant()["questions"][0]} for _ in range(12)]
    output = {"summary": "Review summary.", "questions": [{"question_id": question["question_id"],
        "strengths": ["長" * 1900] * 5, "improvements": ["長" * 1900] * 5,
        "example_answer": "長" * 5900} for question in grant["questions"]]}
    request, dependencies = request_and_dependencies(task_dependencies, grant)
    with interview_session_feedback_agent.override(model=TestModel(custom_output_args=output)):
        result = handle_ai_task(request, dependencies)
    assert result.status == "failed" and result.usage


def test_known_contact_is_masked_and_output_restored(task_dependencies):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai.usage import RequestUsage

    from agents.interview_session_feedback_agent import interview_session_feedback_agent
    from privacy.contact_mask import contact_scope, install_contact_hooks
    from privacy.known_contact import KnownContact
    grant = saved_grant()
    grant["questions"][0]["dialogue"][0]["content"] = "I am Avery Sample and I planned a workshop."
    request, dependencies = request_and_dependencies(task_dependencies, grant)
    async def respond(messages, info):
        prompt = messages[-1].parts[-1].content
        assert "Avery Sample" not in prompt and "«name»" in prompt
        output = coaching(grant["questions"][0]["question_id"])
        output["questions"][0]["example_answer"] = "I am «name» and I planned a workshop."
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)],
            usage=RequestUsage(input_tokens=50, output_tokens=25), model_name="gpt-6-luna")
    install_contact_hooks()
    with contact_scope(KnownContact.from_values(names=["Avery Sample"])), \
            interview_session_feedback_agent.override(model=FunctionModel(respond)):
        result = handle_ai_task(request, dependencies)
    assert result.status == "completed"
    assert "Avery Sample" in result.result["interview_session_feedback"]["questions"][0]["example_answer"]
