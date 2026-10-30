"""Configure shared Logfire instrumentation and private per-call context.

HTTP execution, workers and evaluations use the same model instrumentation,
prompt labels, contact-safe processors and bounded flushing. Queue task spans
and their message identities belong to worker.task_tracing.
"""

import atexit
import os
from collections.abc import Iterator
from contextlib import contextmanager
from threading import Lock

import logfire
from opentelemetry import trace
from opentelemetry.sdk.trace import SpanProcessor
from pydantic_ai import Agent, Embedder, InstrumentationSettings, prices

from privacy.contact_mask import install_contact_hooks
from telemetry.flush import BoundedTelemetryFlush
from telemetry.privacy import ContactLogProcessor, ContactSpanProcessor, telemetry_scope

_flush = BoundedTelemetryFlush(lambda: logfire.force_flush(timeout_millis=5000))
_price_updater = None


class ChatFallbackSpanProcessor(SpanProcessor):
    """Give chat's model-selection span a neutral name while retaining its attributes."""

    def on_start(self, span, parent_context=None):
        pass

    def on_end(self, span):
        attributes = span.attributes or {}
        if (attributes.get("chat_operation_id") and
                attributes.get("gen_ai.operation.name") == "chat" and
                span.name.startswith("chat fallback:")):
            span._name = "chat model request"

    def shutdown(self):
        pass

    def force_flush(self, timeout_millis=30000):
        return True


class OperationCostSpanProcessor(SpanProcessor):
    """Copies the sum of priced model-call spans onto each trace root."""

    def __init__(self):
        self._cost_by_trace: dict[int, float] = {}
        self._lock = Lock()

    def on_start(self, span, parent_context=None):
        """Starts a fresh total for each root trace."""
        if span.parent is None:
            with self._lock:
                self._cost_by_trace[span.context.trace_id] = 0.0

    def on_end(self, span):
        """Accumulates model-call costs and writes the total before export."""
        attributes = dict(span.attributes or {})
        trace_id = span.context.trace_id
        if span.parent is not None:
            cost = attributes.get("operation.cost")
            if attributes.get("gen_ai.operation.name") and isinstance(cost, (int, float)):
                with self._lock:
                    self._cost_by_trace[trace_id] = self._cost_by_trace.get(trace_id, 0.0) + cost
            return

        with self._lock:
            total = self._cost_by_trace.pop(trace_id, 0.0)
        attributes["operation.cost"] = total
        span._attributes = attributes

    def shutdown(self):
        """Drops any trace totals left behind by interrupted work."""
        with self._lock:
            self._cost_by_trace.clear()

    def force_flush(self, timeout_millis=30000):
        """No buffered telemetry is retained."""
        return True


def configure_tracing(additional_span_processors=(), *, distributed_tracing=None) -> None:
    """Configures env-based export and optional caller-owned synchronous span collectors.

    Pass distributed_tracing=True only in services that should join callers' traces
    (the MCP tool server); others keep Logfire's default warning about incoming context.
    """
    global _price_updater
    export_enabled = bool(os.getenv("LOGFIRE_TOKEN", "").strip())
    if export_enabled and _price_updater is None:
        _price_updater = prices.update_in_background()
        atexit.register(_price_updater.stop)
    logfire.configure(
        send_to_logfire=export_enabled,
        service_name="careergrind-ai",
        console=False,
        metrics=logfire.MetricsOptions(collect_in_spans=True),
        inspect_arguments=False,
        additional_span_processors=[ContactSpanProcessor(), ChatFallbackSpanProcessor(), OperationCostSpanProcessor(),
                                    *additional_span_processors],
        advanced=logfire.AdvancedOptions(log_record_processors=[ContactLogProcessor()]),
        distributed_tracing=distributed_tracing,
    )
    instrumentation = InstrumentationSettings(tracer_provider=trace.get_tracer_provider())
    Agent.instrument_all(instrumentation)
    Embedder.instrument_all(instrumentation)
    install_contact_hooks()


def flush_tracing() -> None:
    """Bounds flushing so an unavailable telemetry backend does not stall execution."""
    _flush.flush()


@contextmanager
def record_prompt_version(version: str) -> Iterator[None]:
    """Labels spans created by this particular prompt without changing sibling calls."""
    with telemetry_scope(prompt_version=version):
        yield
