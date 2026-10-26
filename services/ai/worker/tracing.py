"""
Description: Logfire tracing for tasks, agents, embeddings, and per-call prompt versions.
Index:
    - configure_tracing: configures env-based export and connected instrumentation
    - trace_ai_task: groups one task and always flushes with bounded waiting
    - record_prompt_version: labels each nested model call with its prompt version
    - flush_tracing: waits at most five seconds for one shared background flush
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

from worker.contact_mask import install_contact_hooks, using_known_contact
from worker.queue_messages import AiTaskMessage
from worker.telemetry_flush import BoundedTelemetryFlush
from worker.telemetry_privacy import ContactLogProcessor, ContactSpanProcessor, telemetry_scope

_flush = BoundedTelemetryFlush(lambda: logfire.force_flush(timeout_millis=5000))
_price_updater = None


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


def configure_tracing(additional_span_processors=()) -> None:
    """Configures env-based export and optional caller-owned synchronous span collectors."""
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
        additional_span_processors=[ContactSpanProcessor(), OperationCostSpanProcessor(),
                                    *additional_span_processors],
        advanced=logfire.AdvancedOptions(log_record_processors=[ContactLogProcessor()]),
    )
    instrumentation = InstrumentationSettings(tracer_provider=trace.get_tracer_provider())
    Agent.instrument_all(instrumentation)
    Embedder.instrument_all(instrumentation)
    install_contact_hooks()


def flush_tracing() -> None:
    """Bounds flushing so an unavailable telemetry backend does not stall the worker."""
    _flush.flush()


@contextmanager
def trace_ai_task(task: AiTaskMessage, *, task_usage=None, guardrail_usage=None) -> Iterator[None]:
    """Groups task identity and contact-safe input, flushing on success or failure."""
    try:
        with (
            using_known_contact(task),
            telemetry_scope(
                user_id=str(task.user_id),
                ai_task_id=str(task.ai_task_id),
                task_type=task.task_type,
            ),
            # Import filenames can themselves contain undiscovered contact. Pending
            # spans may export before extraction; only record the task's type here.
            logfire.span(f"ai_task.{task.task_type}",
                         input={} if task.task_type == "parse_resume" else task.input) as task_span,
        ):
            try:
                yield
            finally:
                task_entries = list(getattr(task_usage, "entries", ()) or ())
                # The task-wide request observer is authoritative when it saw calls;
                # otherwise retain the separately collected guardrail usage.
                usages = task_entries or list(guardrail_usage or ())
                if task_usage is not None or guardrail_usage is not None:
                    task_span.set_attribute(
                        "cost_incomplete",
                        any(usage.cost_microdollars is None for usage in usages)
                        or bool(getattr(task_usage, "incomplete", False)),
                    )
    finally:
        flush_tracing()


@contextmanager
def record_prompt_version(version: str) -> Iterator[None]:
    """Labels spans created by this particular prompt without changing sibling calls."""
    with telemetry_scope(prompt_version=version):
        yield
