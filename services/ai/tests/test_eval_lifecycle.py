"""Exercise the shared evaluation lifecycle with native offline reports."""

import pytest
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator

from evals import telemetry
from evals.report_capture import capture_run


class Quality(Evaluator):
    """Supply a numeric score without a provider."""

    def evaluate(self, context):
        """Give each synthetic output a known score."""
        return 0.75


def test_lifecycle_returns_native_report_and_scores(monkeypatch, capsys):
    """Keep metadata, scores, terminal output and flushing in one public run."""
    scores, flushes = [], []
    monkeypatch.setattr(telemetry, "record_score", lambda name, value: scores.append((name, value)))
    monkeypatch.setattr(telemetry, "flush_tracing", lambda: flushes.append(True))
    dataset = Dataset(name="offline", cases=[Case(name="sample", inputs="hello")], evaluators=[Quality()])
    with capture_run() as capture:
        report = telemetry.evaluate_dataset(
            lambda: dataset, lambda value: value, name="evals.offline", evaluation_name="offline:model",
            metadata={"model": "offline"}, tags=["synthetic"], version="v1", max_concurrency=2,
        )
    assert capture.report is report
    assert capture.metadata == {"eval_name": "evals.offline", "model": "offline"}
    assert report.name == "offline:model"
    assert scores == [("Quality", 0.75)]
    assert flushes == [True]
    assert "sample" in capsys.readouterr().out


@pytest.mark.parametrize("failure_step", ["averages", "print"])
def test_completed_report_survives_reporting_errors(monkeypatch, failure_step):
    """A report stays available when aggregation or terminal rendering raises."""
    report = Dataset(name="offline", cases=[Case(inputs="hello")]).evaluate_sync(lambda value: value)
    flushes = []
    monkeypatch.setattr(telemetry, "flush_tracing", lambda: flushes.append(True))
    monkeypatch.setattr(Dataset, "evaluate_sync", lambda *args, **kwargs: report)

    def fail(*args, **kwargs):
        """Simulate a reporting failure after real evaluation has completed."""
        raise RuntimeError("reporting failed")

    monkeypatch.setattr(type(report), failure_step, fail)
    with capture_run() as capture:
        with pytest.raises(RuntimeError, match="reporting failed"):
            telemetry.evaluate_dataset(lambda: Dataset(name="unused", cases=[]), str, name="evals.offline",
                                       evaluation_name="offline", max_concurrency=1)
        assert capture.report is report
    assert flushes == [True]


def test_evaluation_exception_propagates_and_flushes(monkeypatch):
    """An evaluation-level failure has no completed report and still flushes tracing."""
    failure = RuntimeError("evaluation failed")
    flushes = []
    monkeypatch.setattr(telemetry, "flush_tracing", lambda: flushes.append(True))

    def fail(*args, **kwargs):
        """Simulate the SDK failing before it can return a report."""
        raise failure

    monkeypatch.setattr(Dataset, "evaluate_sync", fail)
    with capture_run() as capture:
        with pytest.raises(RuntimeError) as caught:
            telemetry.evaluate_dataset(lambda: Dataset(name="offline", cases=[]), str, name="evals.offline",
                                       evaluation_name="offline", max_concurrency=1)
        assert caught.value is failure
        assert capture.report is None
    assert flushes == [True]


def test_ordinary_print_options_and_case_failure_policy(monkeypatch):
    """Case failures remain native reports and ordinary terminal options stay unchanged."""
    printed = []

    def failed_task(value):
        """Fail one case without failing the dataset evaluation itself."""
        if value == "fail":
            raise ValueError("case failed")
        return value

    from pydantic_evals.reporting import EvaluationReport

    monkeypatch.setattr(EvaluationReport, "print", lambda self, **options: printed.append(options))
    report = telemetry.evaluate_dataset(
        lambda: Dataset(name="offline", cases=[Case(inputs="hello"), Case(inputs="fail")]), failed_task,
        name="evals.offline", evaluation_name="offline", max_concurrency=1,
    )
    assert len(report.failures) == 1
    assert printed == [{"include_input": False, "include_output": False, "include_durations": True}]


def test_all_failed_cases_preserve_existing_aggregation_failure():
    """Ordinary suites retain the all-failure report before native averages is unavailable."""
    def failed_task(value):
        """Return no successful cases, matching a complete provider outage."""
        raise RuntimeError("offline outage")

    with capture_run() as capture:
        with pytest.raises(AttributeError, match="scores"):
            telemetry.evaluate_dataset(
                lambda: Dataset(name="offline", cases=[Case(inputs="hello")]), failed_task,
                name="evals.offline", evaluation_name="offline", max_concurrency=1,
            )
        assert len(capture.report.failures) == 1


def test_dataset_load_failure_keeps_metadata_and_flushes(monkeypatch):
    """A malformed fixture fails within the traced run, before any report exists."""
    flushes = []
    monkeypatch.setattr(telemetry, "flush_tracing", lambda: flushes.append(True))

    def load_dataset():
        """Stand in for a malformed YAML fixture."""
        raise ValueError("invalid fixture")

    with capture_run() as capture:
        with pytest.raises(ValueError, match="invalid fixture"):
            telemetry.evaluate_dataset(
                load_dataset, str, name="evals.offline", evaluation_name="offline",
                metadata={"model": "offline"}, max_concurrency=1,
            )
        assert capture.report is None
        assert capture.metadata == {"eval_name": "evals.offline", "model": "offline"}
    assert flushes == [True]


def test_custom_scores_replace_averages_and_print_after_flush(monkeypatch):
    """Specialized suites score a retained native report inside the trace."""
    from pydantic_evals.reporting import EvaluationReport

    events = []
    dataset = Dataset(name="native-default", cases=[Case(inputs="hello")], evaluators=[Quality()])
    monkeypatch.setattr(telemetry, "flush_tracing", lambda: events.append("flush"))
    monkeypatch.setattr(telemetry, "record_score", lambda **kwargs: events.append("ordinary-score"))
    monkeypatch.setattr(EvaluationReport, "print", lambda self, **kwargs: events.append(kwargs))
    with capture_run() as capture:
        def score(report):
            from opentelemetry import trace

            assert trace.get_current_span().get_span_context().is_valid
            assert capture.report is report
            events.append("custom-score")

        report = telemetry.evaluate_dataset(
            lambda: dataset, str, name="custom", max_concurrency=3,
            prepare=lambda: events.append("prepare"), score_report=score,
            print_options={"include_input": False, "include_output": True},
        )
    assert report.name == "str"
    assert events == ["prepare", "custom-score", "flush",
                      {"include_input": False, "include_output": True}]


@pytest.mark.parametrize("failure_kind", ["none", "wrong", "outage", "judge", "report"])
def test_guardrail_native_failure_policy(monkeypatch, failure_kind):
    """Guardrail scores decisions only and preserves its narrower error gate."""
    from pydantic_ai import Agent
    from pydantic_evals.evaluators import ReportEvaluator

    from evals import run_prompt_guardrail_evals as guardrail

    class BrokenCase(Evaluator):
        def evaluate(self, context):
            raise ValueError("case evaluator failed")

    class BrokenReport(ReportEvaluator):
        def evaluate(self, context):
            raise ValueError("report evaluator failed")

    dataset = Dataset(
        name="guardrail",
        cases=[Case(inputs="hello", expected_output=failure_kind != "wrong")],
        evaluators=[BrokenCase()] if failure_kind == "judge" else [Quality()],
        report_evaluators=[BrokenReport()] if failure_kind == "report" else [],
    )

    def generate(self, prompt):
        if failure_kind == "outage":
            raise RuntimeError("screening outage")

    monkeypatch.setattr(Agent, "run_sync", generate)
    monkeypatch.setattr(guardrail, "load_prompt_guardrail_dataset", lambda: dataset)
    scores, flushed = [], []
    monkeypatch.setattr(guardrail, "record_score", lambda **kwargs: scores.append(kwargs))
    monkeypatch.setattr(telemetry, "record_score", lambda **kwargs: pytest.fail("ordinary average"))
    monkeypatch.setattr(telemetry, "flush_tracing", lambda: flushed.append(True))
    with capture_run() as capture:
        if failure_kind in {"none", "report"}:
            guardrail.run_prompt_guardrail_evals()
        else:
            with pytest.raises(RuntimeError, match="errors or incorrect decisions"):
                guardrail.run_prompt_guardrail_evals()
        assert capture.report.name == "check_case"
        assert len(capture.report.report_evaluator_failures) == int(failure_kind == "report")
    assert flushed == [True]
    assert scores == [
        {"name": "decision_accuracy", "value": float(failure_kind not in {"wrong", "outage"})},
        {"name": "case_errors", "value": int(failure_kind in {"outage", "judge"})},
    ]
