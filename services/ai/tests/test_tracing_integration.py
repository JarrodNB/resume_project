"""
Description: Exercises production task tracing and real synthetic Pydantic Evals reporting.
Index:
    - test_production_task_and_synthetic_dataset: task identity, instrumentation and failure flush
"""
from types import SimpleNamespace

import logfire
import pytest
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic_ai import Agent, Embedder
from pydantic_ai.embeddings import TestEmbeddingModel
from pydantic_ai.models.test import TestModel

from evals.telemetry import eval_run, record_score
from privacy.known_contact import KnownContact


def test_production_task_and_synthetic_dataset(monkeypatch):
    """Production instrumentation links tasks and real synthetic Pydantic Evals cases."""
    from pydantic_evals import Case, Dataset
    from pydantic_evals.evaluators import Evaluator

    from telemetry import tracing
    from worker import contact_context as contact_mask
    from worker.queue_messages import AiTaskMessage
    from worker.task_tracing import trace_ai_task

    class SyntheticScore(Evaluator):
        """Scores deterministic synthetic outputs without a provider."""

        def evaluate(self, ctx):
            """Returns a numeric case score."""
            return {"accuracy": float(ctx.output == ctx.expected_output)}

    spans = InMemorySpanExporter()
    original = logfire.configure

    def configure_with_exporter(**kwargs):
        """Keeps production settings and adds a local exporter for inspection."""
        kwargs["additional_span_processors"].append(BatchSpanProcessor(spans))
        return original(**kwargs)

    monkeypatch.setattr(logfire, "configure", configure_with_exporter)
    monkeypatch.setattr(contact_mask, "_load_known_contact", lambda task: KnownContact())
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    tracing.configure_tracing()
    task = AiTaskMessage(
        ai_task_id="00000000-0000-0000-0000-000000000042",
        user_id="00000000-0000-0000-0000-000000000007",
        task_type="parse_resume",
        input={"text": "synthetic"},
    )
    task_usage = SimpleNamespace(
        entries=[],
        incomplete=False,
    )
    with trace_ai_task(task, task_usage=task_usage), eval_run(
        "synthetic-dataset", metadata={"model": "test"}
    ):
        dataset = Dataset(
            name="synthetic",
            cases=[Case(name="synthetic", inputs="hello", expected_output="hello")],
            evaluators=[SyntheticScore()],
        )
        report = dataset.evaluate_sync(lambda value: value)
        for name, value in report.averages().scores.items():
            record_score(name, value)
        Agent(TestModel()).run_sync("synthetic")
        Embedder(TestEmbeddingModel()).embed_query_sync("query")
    finished = spans.get_finished_spans()
    assert len({span.context.trace_id for span in finished}) == 1
    assert all(span.attributes["user_id"] == str(task.user_id) for span in finished)
    assert any(
        span.name == "ai_task.parse_resume" and "input" in span.attributes for span in finished
    )
    task_span = next(span for span in finished if span.name == "ai_task.parse_resume")
    assert task_span.attributes["cost_incomplete"] is False
    assert any("embed" in span.name for span in finished)
    assert any(span.attributes.get("score_value") == 1.0 for span in finished)
    calls = []
    monkeypatch.setattr(logfire, "force_flush", lambda **kwargs: calls.append(kwargs))
    with pytest.raises(ValueError), trace_ai_task(task):
        raise ValueError("synthetic failure")
    assert calls == [{"timeout_millis": 5000}]
