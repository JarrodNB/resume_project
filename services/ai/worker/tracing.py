"""
Description: Langfuse tracing. Pydantic AI's OpenTelemetry spans are exported to Langfuse,
grouped into one trace per task and tagged with the user and task IDs. Known name, contact
email, and phone are placeholders on the trace and on the model request.
Index:
    - configure_tracing: creates the Langfuse client and instruments all agents and embedders
      (call once)
    - trace_ai_task: context manager that wraps one task in a trace and flushes it afterwards
"""

from collections.abc import Iterator
from contextlib import contextmanager

from langfuse import Langfuse, get_client, propagate_attributes
from pydantic_ai import Agent, Embedder

from worker.contact_mask import install_contact_hooks, mask_langfuse_payload, using_known_contact
from worker.queue_messages import AiTaskMessage


def configure_tracing() -> None:
    """Initialises Langfuse from LANGFUSE_* env vars and turns on agent and embedder
    instrumentation. Known contact is masked on the way out."""
    Langfuse(mask=mask_langfuse_payload)
    Agent.instrument_all()
    Embedder.instrument_all()
    install_contact_hooks()


@contextmanager
def trace_ai_task(task: AiTaskMessage) -> Iterator[None]:
    """Runs the enclosed block inside a Langfuse trace for `task`, then flushes it.
    The trace input and model calls use placeholders for the user's known contact."""
    langfuse = get_client()
    trace_name = f"ai_task.{task.task_type}"
    try:
        with (
            using_known_contact(task),
            langfuse.start_as_current_observation(name=trace_name, input=task.input),
            propagate_attributes(
                user_id=str(task.user_id),
                trace_name=trace_name,
                tags=[task.task_type],
                metadata={"ai_task_id": str(task.ai_task_id)},
            ),
        ):
            yield
    finally:
        langfuse.flush()
