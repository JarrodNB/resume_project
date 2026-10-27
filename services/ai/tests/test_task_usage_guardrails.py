"""
Description: Real composed screening and generation accounting through queued task execution.
Index:
    - test_composed_calls_are_counted_once: no double counting handler or guardrail aggregates
"""
import json

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage
from pydantic_ai_harness import InputGuardrail

from agents.user_text_screen_agent import screen_user_message
from llm.generative_model import generative_model
from llm.model_prices import build_model_usage
from screening.prompt_guardrail import screen_prompt
from tests.test_process_task_message import FakeResultQueue, build_task_body
from worker import main
from worker.queue_messages import AiResultMessage


@pytest.mark.real_guardrail
def test_composed_calls_are_counted_once(monkeypatch, task_dependencies, offline_model_resolution):
    """Pre-screening, the assembled prompt guard and generation each contribute one charge."""
    def classify(messages, info):
        """Returns benign screening output with explicit provider usage."""
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            usage=RequestUsage(input_tokens=100), model_name="jev-1.13.0",
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    def answer(messages, info):
        """Returns cached-input and output usage from the generative provider."""
        return ModelResponse(parts=[TextPart("ok")], model_name="openai:gpt-5-mini",
            usage=RequestUsage(input_tokens=100, cache_read_tokens=40, output_tokens=20))

    def handler(task, dependencies):
        """Keeps legacy aggregates to verify that central request accounting supersedes them."""
        screened = screen_user_message("career note", "typesafe:jev-1.13.0", 5)
        model = FunctionModel(answer, model_name="openai:gpt-5-mini")
        run = Agent(generative_model(model, model), capabilities=[InputGuardrail(guard=screen_prompt)]).run_sync("career note")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", usage=[
            build_model_usage("jev-1.13.0", screened.usage),
            build_model_usage("openai:gpt-5-mini", run.usage),
        ])

    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test")
    monkeypatch.setattr(main, "handle_ai_task", handler)
    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(classify, model_name="jev-1.13.0"))
    queue = FakeResultQueue()
    assert main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "completed"
    assert len(result["usage"]) == 3
    assert sum(entry["input_tokens"] for entry in result["usage"]) == 300
    assert sum(entry["cached_input_tokens"] for entry in result["usage"]) == 40
    assert sum(entry["cost_microdollars"] for entry in result["usage"]) == 66
    assert not result["usage_incomplete"]
