"""
Description: Native Logfire eval run context and numeric aggregate score events.
Index:
    - eval_run: groups nested case, judge, agent, and embedding spans; always flushes
    - record_score: emits a numeric aggregate with its score name on the current trace
"""

from contextlib import contextmanager

import logfire

from worker.telemetry_privacy import telemetry_scope
from worker.tracing import flush_tracing


@contextmanager
def eval_run(name, metadata=None, tags=None, version=None):
    """Preserves run/model context and flushes even if evaluation raises."""
    attributes = {"eval_name": name, **(metadata or {})}
    if version:
        attributes["prompt_version"] = version
    try:
        with (
            telemetry_scope(**attributes),
            logfire.with_tags("eval", *(tags or [])).span(
                name,
                **attributes,
            ),
        ):
            yield
    finally:
        flush_tracing()


def record_score(name, value):
    """Records the aggregate as a numeric value for comparisons and queries."""
    logfire.info("eval.score", score_name=name, score_value=float(value))
