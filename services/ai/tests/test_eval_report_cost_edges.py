"""
Description: Offline report cost edge cases for validation retries and response identities.
Index:
    - test_validation_retries: charges every provider response once before failed validation
    - test_response_model_prices: preserves actual model prices and snapshot normalization
    - test_unreported_usage: no provider usage is treated as unknown
"""

import pytest
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.usage import RequestUsage

from evals.report_capture import capture_run, report_span_processors
from evals.report_cost_markdown import cost_label
from telemetry.tracing import configure_tracing
from tests.test_eval_report_costs import ProviderModel


def test_validation_retries():
    """Two invalid structured responses remain counted after the agent exhausts retries."""
    class Output(BaseModel):
        """Requires a number that the offline provider intentionally omits."""

        number: int

    def invalid_answer(messages, info):
        """Reports known usage for every invalid model response."""
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})],
                             usage=RequestUsage(input_tokens=100, output_tokens=20))

    with capture_run() as capture:
        configure_tracing(additional_span_processors=report_span_processors())
        with pytest.raises(Exception, match="Exceeded maximum output retries"):
            Agent(ProviderModel(invalid_answer, model_name="gpt-5-mini"),
                  output_type=Output, retries=1).run_sync("query")
    assert capture.costs.summary()["calls"] == 2
    assert capture.costs.summary()["known_cost_microdollars"] == 130
    assert capture.costs.summary()["complete"]


@pytest.mark.parametrize("response_model, expected_model, complete", [
    ("gpt-5-mini-2026-01-01", "openai:gpt-5-mini", True),
    ("gpt-5", "openai:gpt-5", True),
    ("gpt-unknown", "openai:gpt-unknown", False),
])
def test_response_model_prices(response_model, expected_model, complete):
    """Uses the model that answered, normalizing snapshots only to the requested base."""
    class ResponseModel(ProviderModel):
        """Returns an explicit provider response identity independently of the request."""

        async def request(self, messages, model_settings, model_request_parameters):
            """Provides a known usage response with the selected response identity."""
            return ModelResponse(parts=[TextPart("answer")], model_name=response_model,
                                 usage=RequestUsage(input_tokens=100, output_tokens=20))

    with capture_run() as capture:
        configure_tracing(additional_span_processors=report_span_processors())
        Agent(ResponseModel(lambda *args: None, model_name="gpt-5-mini")).run_sync("query")
    summary = capture.costs.summary()
    assert summary["models"][0]["model"] == expected_model
    assert summary["complete"] is complete


def test_unreported_usage():
    """Successful responses without token usage remain an incomplete unknown charge."""
    class MissingUsageModel(ProviderModel):
        """Simulates a provider that returns content but omits usage."""

        async def request(self, messages, model_settings, model_request_parameters):
            """Returns no usage fields, bypassing FunctionModel's synthetic estimator."""
            return ModelResponse(parts=[TextPart("answer")], model_name="gpt-5-mini")

    with capture_run() as capture:
        configure_tracing(additional_span_processors=report_span_processors())
        Agent(MissingUsageModel(lambda *args: None, model_name="gpt-5-mini")).run_sync("query")
    summary = capture.costs.summary()
    assert not summary["complete"] and summary["calls"] == 1
    assert cost_label(summary) == "Known USD subtotal $0.000000; incomplete"
