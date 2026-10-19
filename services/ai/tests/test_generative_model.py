"""
Description: Tests for the generative fallback model and billing the model that answered.
Index:
    - test_*: one behavior per test
"""

from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import RunUsage

from agents.resume_parsing_agent import parse_resume_text, resume_parsing_agent
from worker.generative_model import generative_model


def test_generative_model_uses_the_primary_when_names_match() -> None:
    """The same name is not wrapped, so one outage does not call that model twice."""
    assert generative_model("openai:gpt-5-mini", "openai:gpt-5-mini") == "openai:gpt-5-mini"


def test_generative_model_falls_back_to_a_different_model() -> None:
    """A different fallback name becomes a FallbackModel in primary, then fallback, order."""
    model = generative_model("openai:gpt-5-mini", "openai:gpt-5-nano")

    assert isinstance(model, FallbackModel)
    assert [item.model_name for item in model.models] == ["gpt-5-mini", "gpt-5-nano"]


def test_parse_resume_bills_the_priced_model_that_answered() -> None:
    """A response that names a priced model is billed as that model, not the primary."""

    def answer(_messages: list[object], info: AgentInfo) -> ModelResponse:
        """An empty parse attributed to the fallback model."""
        return ModelResponse(
            parts=[ToolCallPart(tool_name=info.output_tools[0].name, args={})],
            usage=RunUsage(input_tokens=12, output_tokens=4),
        )

    with resume_parsing_agent.override(model=FunctionModel(answer, model_name="openai:gpt-5-nano")):
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
