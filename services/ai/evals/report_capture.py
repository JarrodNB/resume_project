"""
Description: Optional report capture shared by existing eval runners and the report CLI.
Index:
    - ReportCapture: report and configuration captured during one runner invocation
    - capture_run: isolates report capture from standalone runner calls
    - capture_report / capture_metadata: retain the native report and trace configuration
    - override_settings: copies settings for an explicit eval-only model choice
    - report_span_processors: attaches cost collection only to an active report
"""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from evals.report_costs import ReportCostProcessor, ReportCosts


@dataclass
class ReportCapture:
    """Native report and configuration retained even when the runner subsequently fails."""

    report: Any = None
    metadata: dict = field(default_factory=dict)
    costs: ReportCosts = field(default_factory=ReportCosts)


_ACTIVE: ContextVar[ReportCapture | None] = ContextVar("eval_report_capture", default=None)


def report_span_processors():
    """Returns one scoped synchronous usage collector, or none for standalone evals."""
    capture = _ACTIVE.get()
    return ([ReportCostProcessor(capture.costs, lambda: _ACTIVE.get() is capture)]
            if capture is not None else [])


@contextmanager
def capture_run():
    """Captures one runner without changing standalone behavior or leaking between runs."""
    capture = ReportCapture()
    token = _ACTIVE.set(capture)
    try:
        yield capture
    finally:
        _ACTIVE.reset(token)


def capture_report(report):
    """Retains a finished dataset report before printing or failure checks can raise."""
    if (capture := _ACTIVE.get()) is not None:
        capture.report = report


def capture_metadata(metadata):
    """Copies model, judge, prompt and reasoning configuration from the eval trace."""
    if (capture := _ACTIVE.get()) is not None:
        capture.metadata.update(metadata)


def override_settings(settings, model_field: str, model: str | None):
    """Copies an eval model override, disabling fallback so comparisons use that model."""
    if model is None:
        return settings
    updates = {model_field: model}
    if model_field not in {"embedding_model", "user_text_screen_model"}:
        updates["generative_fallback_model"] = model
    return settings.model_copy(update=updates)
