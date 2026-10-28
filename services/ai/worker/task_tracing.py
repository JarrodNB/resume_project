"""Wrap queue-task identity and outcomes in shared contact-safe telemetry.

Generic instrumentation is owned by telemetry.tracing. This adapter adds queue
message fields and preserves unknown-cost state through failure and final flushing.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import logfire

from telemetry.privacy import telemetry_scope
from telemetry.tracing import flush_tracing
from worker.contact_context import using_known_contact
from worker.queue_messages import AiTaskMessage


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
