"""
Description: Offline SDK request integration for report costs, retries and auxiliary calls.
Index:
    - test_native_requests: caches, screening, judges, embeddings and case alignment
    - test_failed_calls_and_unknown_prices: conservative failure estimates and isolation
    - test_fake_models_and_missing_capture: no fictitious zero-cost totals
"""

from pydantic_ai import Agent, Embedder
from pydantic_ai.embeddings import TestEmbeddingModel
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RequestUsage
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import LLMJudge

from evals.report_capture import capture_run, report_span_processors
from evals.report_cost_markdown import render_cost_comparison, render_costs
from worker.tracing import configure_tracing


class ProviderModel(FunctionModel):
    """Offline function model with explicit OpenAI identity and reported request usage."""

    @property
    def system(self):
        """Reports the provider identity needed for local model price normalization."""
        return "openai"


def _model(name="gpt-5-mini", input_tokens=100, output_tokens=20, cached_tokens=40):
    """Returns a fake provider that handles ordinary text and genuine LLMJudge output."""
    def answer(messages, info):
        """Provides fixed usage and structured judge scores without network requests."""
        parts = ([ToolCallPart(info.output_tools[0].name, {"score": 0.75, "pass": True, "reason": "synthetic judge"})]
                 if info.output_tools else [TextPart("synthetic answer")])
        return ModelResponse(parts=parts, usage=RequestUsage(input_tokens=input_tokens,
            output_tokens=output_tokens, cache_read_tokens=cached_tokens))

    return ProviderModel(answer, model_name=name)


def test_native_requests():
    """Real instrumentation captures auxiliary providers and judges once in concurrent cases."""
    screen = _model("jev-1.13.0", input_tokens=50, output_tokens=0, cached_tokens=0)
    generator = _model()
    judge = _model("gpt-5", input_tokens=80, output_tokens=10, cached_tokens=0)
    embedder = Embedder(TestEmbeddingModel("text-embedding-3-small", provider_name="openai"))

    async def task(value):
        """Exercises a screening call, two embedding paths and a generative call."""
        await Agent(screen).run(value)
        await embedder.embed_documents([value])
        await embedder.embed_query(value)
        return (await Agent(generator).run(value)).output

    with capture_run() as capture:
        configure_tracing(additional_span_processors=report_span_processors())
        report = Dataset(name="offline costs", cases=[Case(name=name, inputs="query text") for name in ("first", "second")],
                         evaluators=[LLMJudge("quality", model=judge, assertion=False)]).evaluate_sync(task)
    assert not report.failures
    assert all(not case.evaluator_failures for case in report.cases), [case.evaluator_failures for case in report.cases]
    summary = capture.costs.summary()
    assert summary["calls"] == 10
    assert summary["complete"]
    rows = {row["model"]: row for row in summary["models"]}
    assert rows["openai:gpt-5-mini"]["cached_input_tokens"] == 80
    assert rows["openai:gpt-5-mini"]["input_tokens"] == 200
    assert rows["openai:gpt-5-mini"]["known_cost_microdollars"] == 112
    assert rows["jev-1.13.0"]["calls"] == 2
    assert rows["openai:gpt-5"]["calls"] == 2
    assert rows["openai:text-embedding-3-small"]["calls"] == 4
    assert capture.costs.summary("first")["calls"] == 5
    comparison = render_cost_comparison([{"model": "A", "costs": capture.costs}, {"model": "B"}],
                                      ["second", "first"])
    assert any("| first | Estimated USD" in line and "Unavailable" in line for line in comparison)
    assert "Cached input tokens" in "\n".join(render_costs(capture.costs))


def test_failed_calls_and_unknown_prices():
    """Paid requests before task errors survive, failures and unknown models stay incomplete."""
    def outage(messages, info):
        """Fails before provider usage is available."""
        raise RuntimeError("provider unavailable")

    async def task(value):
        """Returns one known response before a subsequent provider error."""
        await Agent(_model()).run(value)
        await Agent(ProviderModel(outage, model_name="gpt-5-mini")).run(value)

    with capture_run() as capture:
        configure_tracing(additional_span_processors=report_span_processors())
        report = Dataset(name="offline costs", cases=[Case(name="failed", inputs="query")]).evaluate_sync(task)
        Agent(_model("unpriced-model")).run_sync("query")
    assert len(report.failures) == 1
    summary = capture.costs.summary()
    assert summary["calls"] == 3 and not summary["complete"]
    assert summary["known_cost_microdollars"] == 56
    assert "Provider usage unavailable" in summary["issues"]
    assert "Price unavailable: openai:unpriced-model" in summary["issues"]
    assert "incomplete" in "\n".join(render_costs(capture.costs))
    Agent(_model()).run_sync("outside capture")
    assert capture.costs.summary()["calls"] == 3
    with capture_run() as second:
        configure_tracing(additional_span_processors=report_span_processors())
        Agent(_model()).run_sync("second capture")
    assert second.costs.summary()["calls"] == 1
    assert capture.costs.summary()["calls"] == 3


def test_fake_models_and_missing_capture():
    """Explicit fake providers and uninstrumented runs are unavailable, never assumed free."""
    assert report_span_processors() == []
    with capture_run() as capture:
        configure_tracing(additional_span_processors=report_span_processors())
        Agent(TestModel()).run_sync("fake")
        Embedder(TestEmbeddingModel()).embed_query_sync("fake")
    assert capture.costs.summary()["calls"] == 0
    assert "Unavailable" in "\n".join(render_costs(capture.costs))
