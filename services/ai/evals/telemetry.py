"""
Description: Native Logfire eval run context and numeric aggregate score events.
Index:
    - evaluate_dataset: evaluates, retains, scores and prints all native suite reports
    - record_average_scores: emits ordinary numeric averages for suites that use them
    - eval_run: groups nested case, judge, agent, and embedding spans; always flushes
    - record_score: emits a numeric aggregate with its score name on the current trace
"""

from contextlib import contextmanager

import logfire
from pydantic_evals.reporting import EvaluationReport

from evals.report_capture import capture_metadata, capture_report, report_span_processors
from worker.telemetry_privacy import telemetry_scope
from worker.tracing import configure_tracing, flush_tracing


def evaluate_dataset(
    load_dataset, task, *, name, evaluation_name=None, metadata=None, tags=None, version=None,
    max_concurrency, prepare=None, score_report=None, print_options=None,
) -> EvaluationReport:
    """Evaluate, retain and score a native report, then print it after tracing flushes.

    Setup runs after tracing configuration but outside the run span, preserving
    interview judge construction timing. A custom scorer replaces ordinary averages.
    Capture happens before aggregation or printing so report tools can still save a
    completed report when either step fails. Evaluation exceptions propagate unchanged.
    """
    configure_tracing(additional_span_processors=report_span_processors())
    if prepare is not None:
        prepare()
    with eval_run(name=name, metadata=metadata, tags=tags, version=version):
        report = load_dataset().evaluate_sync(
            task, max_concurrency=max_concurrency,
            **({"name": evaluation_name} if evaluation_name is not None else {}),
        )
        capture_report(report)
        if score_report is None:
            record_average_scores(report)
        else:
            score_report(report)
    report.print(**(print_options if print_options is not None else {
        "include_input": False, "include_output": False, "include_durations": True,
    }))
    return report


def record_average_scores(report):
    """Emit each native numeric average without changing suite failure policies."""
    for score_name, average in report.averages().scores.items():
        record_score(name=score_name, value=average)


@contextmanager
def eval_run(name, metadata=None, tags=None, version=None):
    """Preserves run/model context and flushes even if evaluation raises."""
    attributes = {"eval_name": name, **(metadata or {})}
    capture_metadata(attributes)
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
