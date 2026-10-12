"""
Description: Task-scoped accounting for Jev calls made by agent capabilities, even on blocks.
Index:
    - collect_guardrail_usage: isolates one task's capability usage
    - record_guardrail_usage: appends a priced screening call to the active task
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from pydantic_ai.usage import RunUsage

from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import ModelUsage

_current: ContextVar[list[ModelUsage] | None] = ContextVar("guardrail_usage", default=None)


@contextmanager
def collect_guardrail_usage(usage: list[ModelUsage]) -> Iterator[None]:
    """Collects capability usage for this task and resets the scope on every exit path."""
    token = _current.set(usage)
    try:
        yield
    finally:
        _current.reset(token)


def record_guardrail_usage(model: str, configured_model: str, usage: RunUsage) -> None:
    """Keeps screening usage separate from generative tokens and model prices."""
    current = _current.get()
    if current is not None:
        current.append(build_model_usage(reported_model_name(model, configured_model), usage))
