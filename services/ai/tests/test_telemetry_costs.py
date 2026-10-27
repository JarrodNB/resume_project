"""Check production cost telemetry without provider or pricing download requests."""

import json
from unittest.mock import Mock

import logfire
import pytest
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic_ai import Agent

from telemetry import tracing
from tests.test_eval_report_costs import _model


def test_production_tracing_records_model_and_parent_costs(monkeypatch):
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    update = Mock()
    monkeypatch.setattr(tracing.prices, "update_in_background", update)
    spans = InMemorySpanExporter()
    tracing.configure_tracing([SimpleSpanProcessor(spans)])
    with logfire.span("cost test"):
        Agent(_model("gpt-5-mini")).run_sync("synthetic")
    logfire.force_flush()
    finished = spans.get_finished_spans()
    model = next(s for s in finished if "gen_ai.usage.input_tokens" in s.attributes)
    assert model.attributes["operation.cost"] == pytest.approx(0.000056)
    parent = next(s for s in finished if s.name == "cost test")
    assert parent.attributes["operation.cost"] == pytest.approx(model.attributes["operation.cost"])
    metrics = json.loads(parent.attributes["logfire.metrics"])
    assert metrics["operation.cost"]["total"] == pytest.approx(0.000056)
    update.assert_not_called()


def test_native_price_updates_start_once_with_remote_tracing(monkeypatch):
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")
    monkeypatch.setattr(tracing, "_price_updater", None)
    update = Mock()
    register = Mock()
    monkeypatch.setattr(tracing.prices, "update_in_background", update)
    monkeypatch.setattr(tracing.atexit, "register", register)
    monkeypatch.setattr(tracing.logfire, "configure", Mock())
    tracing.configure_tracing()
    tracing.configure_tracing()
    update.assert_called_once_with()
    register.assert_called_once_with(update.return_value.stop)
