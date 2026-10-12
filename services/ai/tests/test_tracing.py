"""
Description: Exporter-level privacy, nesting, prompt identity, instrumentation, and eval checks.
Index:
    - test_export_masks_completed_span_after_contact_scope_exits: asynchronous export privacy
    - test_agent_embedding_versions_and_numeric_eval_scores: connected nested telemetry
    - test_flush_runs_on_failures: bounded flush in finally
"""

import json
from threading import Thread

import logfire
import pytest
from opentelemetry import trace
from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter, SimpleLogRecordProcessor
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic_ai import Agent, Embedder, InstrumentationSettings
from pydantic_ai.embeddings import TestEmbeddingModel
from pydantic_ai.models.test import TestModel

from evals.telemetry import eval_run, record_score
from worker.contact_mask import contact_scope
from worker.known_contact import KnownContact
from worker.telemetry_privacy import ContactLogProcessor, ContactSpanProcessor, telemetry_scope
from worker.tracing import record_prompt_version


@pytest.fixture
def exporters():
    """Configures real SDK processors with in-memory exporters and no remote requests."""
    spans = InMemorySpanExporter()
    logs = InMemoryLogRecordExporter()
    logfire.configure(
        send_to_logfire=False,
        console=False,
        metrics=False,
        inspect_arguments=False,
        environment="test",
        additional_span_processors=[ContactSpanProcessor(), BatchSpanProcessor(spans)],
        advanced=logfire.AdvancedOptions(
            log_record_processors=[
                ContactLogProcessor(),
                SimpleLogRecordProcessor(logs),
            ]
        ),
    )
    yield spans, logs
    logfire.force_flush(timeout_millis=1000)


@pytest.mark.parametrize("name", ["Alex Rivera", 'Dana "Dee" Smith', "Dana\\Smith\nRivera"])
def test_export_masks_completed_span_after_contact_scope_exits(exporters, name):
    """Exports after scope exit; restored values and exception details remain masked."""
    spans, logs = exporters
    secret = f"{name} alex@example.test +1 555 123 4567"
    contact = KnownContact.from_values(
        names=[name], emails=["alex@example.test"], phones=["+1 555 123 4567"]
    )
    with (  # noqa: SIM117 — preserve parent and child spans
        contact_scope(contact),
        telemetry_scope(ai_task_id="42", user_id="7", task_type="parse_resume"),
        logfire.span("task", input={"text": secret, name: [name, 42, True, None]}),
    ):
        with trace.get_tracer("test").start_as_current_span("restored " + secret) as span:
            span.set_attribute("response", secret)
            span.add_event(secret, {secret: secret})
            span.record_exception(ValueError(secret))
            logfire.info("restored", response=secret)
    thread = Thread(target=lambda: logfire.force_flush(timeout_millis=1000))
    thread.start()
    thread.join()
    rendered = repr(
        [
            (span.name, dict(span.attributes), span.events, span.status)
            for span in spans.get_finished_spans()
        ]
    )
    rendered += repr(
        [
            (record.log_record.body, record.log_record.attributes)
            for record in logs.get_finished_logs()
        ]
    )
    parent = next(span for span in spans.get_finished_spans() if span.name == "task")
    assert json.loads(parent.attributes["input"]) == {
        "text": "«name» «email» «phone»",
        "«name»": ["«name»", 42, True, None],
    }
    for value in (name, "alex@example.test", "+1 555 123 4567"):
        assert value not in rendered
    assert "«name»" in rendered
    assert all(span.attributes["ai_task_id"] == "42" for span in spans.get_finished_spans())


def test_agent_embedding_versions_and_numeric_eval_scores(exporters):
    """Real fake-provider agents/embedders and eval scores share the run trace."""
    spans, _logs = exporters
    instrumentation = InstrumentationSettings(tracer_provider=trace.get_tracer_provider())
    Agent.instrument_all(instrumentation)
    with eval_run("synthetic", metadata={"model": "test", "judge_model": "test"}):
        with record_prompt_version("screen-v1"):
            Agent(TestModel()).run_sync("hello")
        with record_prompt_version("parse-v2"):
            Agent(TestModel()).run_sync("hello again")
        Embedder(TestEmbeddingModel(), instrument=instrumentation).embed_query_sync("query")
        record_score("accuracy", 0.75)
    finished = spans.get_finished_spans()
    assert len({span.context.trace_id for span in finished}) == 1
    versions = {span.attributes.get("prompt_version") for span in finished}
    assert {"screen-v1", "parse-v2"} <= versions
    assert any("embed" in span.name for span in finished)
    scores = [span for span in finished if span.attributes.get("score_name") == "accuracy"]
    assert scores[0].attributes["score_value"] == 0.75
    assert isinstance(scores[0].attributes["score_value"], float)
    assert all(
        span.resource.attributes["deployment.environment.name"] == "test" for span in finished
    )


def test_flush_runs_on_failures(monkeypatch, exporters):
    """Evaluation failures still execute a bounded flush."""
    calls = []
    monkeypatch.setattr(logfire, "force_flush", lambda **kwargs: calls.append(kwargs))
    with pytest.raises(ValueError), eval_run("failure"):
        raise ValueError("synthetic failure")
    assert calls == [{"timeout_millis": 5000}]
