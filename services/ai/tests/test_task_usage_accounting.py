"""
Description: Request costs survive terminal failures and retries through task execution.
Index:
    - test_*: published usage from real local model requests, without external providers
"""
import json

from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from tests.test_process_task_message import FakeResultQueue, build_task_body
from worker import main
from worker.generative_model import generative_model


def test_completed_request_cost_survives_later_run_limit(monkeypatch, task_dependencies):
    """A handler failure cannot discard a provider response already received."""
    def respond(messages, info):
        """Returns known synthetic provider usage."""
        return ModelResponse(parts=[TextPart("allowed")], usage=RequestUsage(input_tokens=100, output_tokens=5),
                             model_name="openai:gpt-5-mini")

    def handler(task, dependencies):
        """Makes a billed request, then fails before returning a result."""
        model = FunctionModel(respond, model_name="openai:gpt-5-mini")
        Agent(generative_model(model, model)).run_sync("synthetic career details")
        raise UsageLimitExceeded("request limit reached")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    assert main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "failed"
    assert sum(entry["input_tokens"] for entry in result["usage"]) == 100
    assert sum(entry["cost_microdollars"] for entry in result["usage"]) == 35


def test_retry_publishes_usage_without_finishing_task(monkeypatch, task_dependencies):
    """Each actual execution reports its known charges and unknown failed-request cost."""
    def respond(messages, info):
        """Returns usage once before a transient provider outage."""
        return ModelResponse(parts=[TextPart("ok")], usage=RequestUsage(input_tokens=100),
                             model_name="openai:gpt-5-mini")

    def unavailable(messages, info):
        """Simulates a paid request whose response usage is unavailable."""
        raise ModelHTTPError(503, "openai:gpt-5-mini", "unavailable")

    def handler(task, dependencies):
        """Makes a completed call followed by one that must be retried."""
        for function in (respond, unavailable):
            model = FunctionModel(function, model_name="openai:gpt-5-mini")
            Agent(generative_model(model, model)).run_sync("synthetic input")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    body = build_task_body()
    for attempt in (1, 2):
        assert not main.process_task_message(body, attempt, queue, task_dependencies)
    reports = [json.loads(raw) for raw in queue.sent_bodies if json.loads(raw)["attempt_finished"]]
    assert len(reports) == 2
    assert all(report["status"] == "usage" for report in reports)
    assert all(report["usage_incomplete"] for report in reports)
    assert all(sum(entry["input_tokens"] for entry in report["usage"]) == 100 for report in reports)
    assert reports[0]["attempt_id"] != reports[1]["attempt_id"]


def test_validation_retries_report_each_response_once(monkeypatch, task_dependencies):
    """Invalid output still bills every received response without guessing missing charges."""
    def invalid(messages, info):
        """Returns a value that cannot satisfy the requested integer output."""
        return ModelResponse(parts=[TextPart("not an integer")], usage=RequestUsage(input_tokens=100),
                             model_name="openai:gpt-5-mini")

    def handler(task, dependencies):
        """Exhausts validation retries after two billed responses."""
        model = FunctionModel(invalid, model_name="openai:gpt-5-mini")
        Agent(generative_model(model, model), output_type=int, retries=1).run_sync("answer")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "failed"
    assert sum(entry["input_tokens"] for entry in result["usage"]) == 200
    assert not result["usage_incomplete"]
