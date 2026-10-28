"""
Description: Screening, fallback and embedding costs survive task execution failures.
Index:
    - test_*: published usage from real local model requests, without external providers
"""
import json

from pydantic_ai import Agent
from pydantic_ai.embeddings import TestEmbeddingModel
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from agents.user_text_screen_agent import screen_user_message
from llm.generative_model import generative_model
from memory.embed_search_query import embed_search_query
from tests.test_process_task_message import FakeResultQueue, build_task_body
from worker import main
from worker.queue_messages import AiResultMessage


def test_embedding_usage_survives_later_failure(monkeypatch, task_dependencies):
    """Embedding charges are collected before later retrieval or generation fails."""
    def handler(task, dependencies):
        """Embeds a synthetic query, then encounters an unrelated failure."""
        embed_search_query("synthetic library search", TestEmbeddingModel(
            model_name="text-embedding-3-small", provider_name="openai"), 8)
        raise RuntimeError("retrieval failed")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "failed"
    assert result["usage"][0]["model"] == "openai:text-embedding-3-small"
    assert result["usage"][0]["input_tokens"] > 0
    assert not result["usage_incomplete"]


def test_successful_fallback_keeps_unknown_primary_cost(monkeypatch, task_dependencies):
    """Fallback success cannot hide the primary request's missing provider usage."""
    def unavailable(messages, info):
        """Fails before response usage becomes available."""
        raise ModelHTTPError(503, "openai:gpt-5-mini", "unavailable")

    def respond(messages, info):
        """Reports the fallback model's actual usage."""
        return ModelResponse(parts=[TextPart("ok")], usage=RequestUsage(input_tokens=100),
                             model_name="openai:gpt-5-nano")

    def handler(task, dependencies):
        """Returns legacy aggregate usage too, which must not double count requests."""
        primary = FunctionModel(unavailable, model_name="openai:gpt-5-mini")
        fallback = FunctionModel(respond, model_name="openai:gpt-5-nano")
        Agent(generative_model(primary, fallback)).run_sync("synthetic input")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "completed"
    assert result["usage_incomplete"]
    assert len(result["usage"]) == 1
    assert result["usage"][0]["model"] == "openai:gpt-5-nano"
    assert result["usage"][0]["cost_microdollars"] == 5


def test_screening_usage_survives_later_failure(monkeypatch, task_dependencies, offline_model_resolution):
    """The screening agent's real run records usage before a later handler failure."""
    def classify(messages, info):
        """Returns the screening schema and synthetic provider tokens."""
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            usage=RequestUsage(input_tokens=100), model_name="jev-1.13.0")

    def handler(task, dependencies):
        """Runs Jev through its normal entry point with an offline model adapter."""
        screen_user_message("synthetic career details", "typesafe:jev-1.13.0", 5)
        raise RuntimeError("later failure")

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(classify, model_name="jev-1.13.0"))
    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "failed"
    assert result["usage"][0]["model"] == "jev-1.13.0"
    assert result["usage"][0]["input_tokens"] == 100
    assert not result["usage_incomplete"]


def test_unpriced_response_retains_tokens_with_unknown_cost(monkeypatch, task_dependencies):
    """A missing local price keeps provider usage without declaring the request free."""
    def answer(messages, info):
        """Returns real-shaped token counts for an unpriced model."""
        return ModelResponse(parts=[TextPart("ok")], model_name="unpriced-model",
                             usage=RequestUsage(input_tokens=100, cache_read_tokens=20))

    def handler(task, dependencies):
        """Completes successfully even though its cost estimate is incomplete."""
        model = FunctionModel(answer, model_name="unpriced-model")
        Agent(generative_model(model, model)).run_sync("synthetic input")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["usage_incomplete"]
    assert result["usage"][0]["input_tokens"] == 100
    assert result["usage"][0]["cached_input_tokens"] == 20
    assert result["usage"][0]["cost_microdollars"] is None
