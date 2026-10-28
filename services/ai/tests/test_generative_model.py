"""
Description: Tests for the generative fallback model and billing the model that answered.
Index:
    - test_*: one behavior per test
"""

import asyncio

import logfire
import pytest
from opentelemetry import trace
from pydantic_ai import Agent, InstrumentationSettings
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import RunUsage

from agents.resume_parsing_agent import parse_resume_text
from llm.generative_model import generative_model
from tests import test_tracing


@pytest.fixture
def exporters():
    yield from test_tracing.exporters.__wrapped__()


@pytest.mark.parametrize("fail_primary", [False, True])
@pytest.mark.parametrize("streamed", [False, True])
def test_trace_names_identify_only_executed_attempts(
    exporters, offline_model_resolution, fail_primary, streamed,
):
    """Exported traces distinguish the primary and fallback, including a failed primary."""
    async def primary(*_):
        if fail_primary:
            raise ModelHTTPError(503, "gpt-5-mini")
        return ModelResponse(parts=[TextPart("done")])

    async def fallback(*_):
        return ModelResponse(parts=[TextPart("done")])

    async def primary_stream(*_):
        if fail_primary:
            raise ModelHTTPError(503, "gpt-5-mini")
        yield "done"

    async def fallback_stream(*_):
        yield "done"

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(
        primary, stream_function=primary_stream, model_name="gpt-5-mini"
    ))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(
        fallback, stream_function=fallback_stream, model_name="gpt-5-nano"
    ))
    agent = Agent(generative_model("openai:gpt-5-mini", "openai:gpt-5-nano"))
    agent.instrument = InstrumentationSettings(tracer_provider=trace.get_tracer_provider())

    async def run():
        if streamed:
            async with agent.run_stream("synthetic input") as result:
                return await result.get_output()
        return (await agent.run("synthetic input")).output

    assert asyncio.run(run()) == "done"
    logfire.force_flush(timeout_millis=1000)
    spans = [span for span in exporters[0].get_finished_spans()
             if "model_attempt.role" in span.attributes]
    assert [span.attributes["logfire.msg"] for span in spans] == (
        ["Primary model attempt: function:gpt-5-mini", "Fallback model attempt: function:gpt-5-nano"]
        if fail_primary else ["Primary model attempt: function:gpt-5-mini"]
    )
    assert all("operation.cost" not in span.attributes for span in spans)


def test_generative_model_uses_the_primary_when_names_match(offline_model_resolution) -> None:
    """The same name is not wrapped, so one outage does not call that model twice."""
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(lambda *_: ModelResponse(parts=[])))
    model = generative_model("openai:gpt-5-mini", "openai:gpt-5-mini")
    assert not isinstance(model, FallbackModel)
    assert model.role == "primary"


def test_generative_model_falls_back_to_a_different_model(offline_model_resolution) -> None:
    """A different fallback name becomes a FallbackModel in primary, then fallback, order."""
    offline_model_resolution(
        "openai:gpt-5-mini",
        FunctionModel(lambda *_: ModelResponse(parts=[]), model_name="gpt-5-mini"),
    )
    offline_model_resolution(
        "openai:gpt-5-nano",
        FunctionModel(lambda *_: ModelResponse(parts=[]), model_name="gpt-5-nano"),
    )
    model = generative_model("openai:gpt-5-mini", "openai:gpt-5-nano")

    assert isinstance(model, FallbackModel)
    assert [item.model_name for item in model.models] == ["gpt-5-mini", "gpt-5-nano"]


def test_parse_resume_bills_the_priced_model_that_answered(offline_model_resolution) -> None:
    """A response that names a priced model is billed as that model, not the primary."""

    def answer(_messages: list[object], info: AgentInfo) -> ModelResponse:
        """An empty parse attributed to the fallback model."""
        return ModelResponse(
            parts=[ToolCallPart(tool_name=info.output_tools[0].name, args={})],
            usage=RunUsage(input_tokens=12, output_tokens=4),
        )

    model = FunctionModel(answer, model_name="openai:gpt-5-nano")
    offline_model_resolution("openai:gpt-5-mini", model)
    offline_model_resolution("openai:gpt-5-nano", model)
    run = parse_resume_text(
        "Jane Doe",
        model="openai:gpt-5-mini",
        thinking="low",
        timeout_seconds=5,
        fallback_model="openai:gpt-5-nano",
    )

    assert run.model == "openai:gpt-5-nano"
    assert run.usage.input_tokens == 36
    assert [entry.model for entry in run.model_usages] == ["openai:gpt-5-nano"] * 3
