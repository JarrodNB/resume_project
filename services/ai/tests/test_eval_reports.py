"""
Description: Offline report persistence, comparison alignment, failures and model isolation.
Index:
    - test_comparison: aligns case identities and retains native scores/reasons/raw outputs
    - test_aligned_outputs_and_reasons: compares raw outputs and evaluator explanations
    - test_every_existing_runner_captures_native_report: covers all ten runner integrations
    - test_failure_artifacts: writes failure reports and returns a nonzero CLI status
    - test_model_validation: rejects incompatible families before any provider call
    - test_override_settings: isolates explicit model comparisons from fallback/defaults
"""

from types import SimpleNamespace

import pytest
from pydantic import BaseModel
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import EqualsExpected, EvaluationReason, Evaluator

from evals import run_report
from evals.report_capture import capture_report, override_settings
from evals.report_markdown import render_report
from worker.settings import load_settings


def _report(names):
    """Builds genuine SDK reports without network requests."""
    dataset = Dataset(name="offline", cases=[Case(name=name, inputs=name, expected_output=name)
                             for name in names], evaluators=[EqualsExpected()])
    return dataset.evaluate_sync(lambda value: value)


def test_comparison():
    """Aligns reordered cases and marks missing cases while retaining native detail."""
    runs = [{"model": model, "configuration": {"judge_model": model},
             "error": None, "report": _report(names)}
            for model, names in [("model-a", ["first", "second"]),
                                 ("model-b", ["second", "first", "third"])]]
    markdown = render_report("example", runs, "now")
    assert "| first | EqualsExpected=True" in markdown
    assert "| third | Missing case" in markdown
    assert '"output": "first"' in markdown
    assert '"judge_model": "model-b"' in markdown
    assert '"task_duration"' in markdown


def test_aligned_outputs_and_reasons():
    """Places different raw outputs and judge reasons in the same case's two columns."""
    class Quality(Evaluator):
        """Returns a synthetic quality judge reason without an LLM call."""

        def evaluate(self, context):
            """Assigns a score with an output-specific explanation."""
            return EvaluationReason(value=0.5, reason=f"Reason for {context.output}")

    runs = []
    for output in ["answer A", "answer B"]:
        dataset = Dataset(name="offline", cases=[Case(name="same", inputs="input")],
                          evaluators=[Quality()])
        report = dataset.evaluate_sync(lambda value, answer=output: answer)
        runs.append({"model": output, "configuration": {}, "error": None, "report": report})
    markdown = render_report("example", runs, "now")
    aligned = markdown.split("## Aligned outputs and evaluator reasons")[1].split("## Run 1 details")[0]
    same_line = next(line for line in aligned.splitlines() if line.startswith("| same |"))
    assert "answer A" in same_line and "answer B" in same_line
    assert "Reason for answer A" in same_line and "Reason for answer B" in same_line


@pytest.mark.parametrize("suite", run_report.SUITES)
def test_every_existing_runner_captures_native_report(monkeypatch, suite):
    """Exercises each real runner's integration while replacing evaluation with offline output."""
    class Output(BaseModel):
        """Synthetic structured output accepted by interview terminal JSON printing."""

        text: str

    native = Dataset(name="offline", cases=[Case(name="same", inputs="input",
                     expected_output=Output(text="input"))]).evaluate_sync(
        lambda value: Output(text=value))
    monkeypatch.setattr(Dataset, "evaluate_sync", lambda *args, **kwargs: native)
    run = run_report.run_suite(suite)
    assert run["report"] is native
    assert run["error"] is None
    assert run["configuration"]["eval_name"] == f"evals.{suite}"
    if suite != "prompt_guardrail":
        model = ("typesafe:jev-1.13.0" if suite == "user_text_screen"
                 else "openai:text-embedding-3-large" if suite == "library_retrieval"
                 else "openai:gpt-5")
        run = run_report.run_suite(suite, model)
        assert run["report"] is native and run["error"] is None
        assert run["configuration"]["model"] == model
        if suite.startswith("interview_"):
            assert run["configuration"]["judge_model"] == model
            assert run["configuration"]["judge_rubrics"]


def test_successful_comparison_cli(monkeypatch, tmp_path):
    """Runs both selected models and saves aligned successful reports with exit status zero."""
    calls = []

    def runner(model_override=None):
        """Returns a native synthetic report for each explicitly selected model."""
        calls.append(model_override)
        capture_report(_report(["same"]))

    monkeypatch.setattr(run_report.importlib, "import_module",
                        lambda name: SimpleNamespace(run_resume_parsing_evals=runner))
    assert run_report.main(["resume_parsing", "--model", "openai:gpt-5-mini",
                            "--model", "openai:gpt-5", "--output-dir", str(tmp_path)]) == 0
    assert calls == ["openai:gpt-5-mini", "openai:gpt-5"]
    assert "| Case | openai:gpt-5-mini | openai:gpt-5 |" in next(tmp_path.glob("*.md")).read_text()


def test_failure_artifacts(monkeypatch, tmp_path):
    """Persists all-case failure reports, returns nonzero and never overwrites a prior run."""
    def failed_task(value):
        """Simulates a provider failure for every case."""
        raise RuntimeError("synthetic provider outage")

    def runner(model_override=None):
        """Captures a real all-failure report before a runner aggregation exception."""
        report = Dataset(name="offline", cases=[Case(name="failed", inputs="data")]).evaluate_sync(failed_task)
        capture_report(report)
        raise RuntimeError("runner failure after evaluation")

    monkeypatch.setattr(run_report.importlib, "import_module",
                        lambda name: SimpleNamespace(run_resume_parsing_evals=runner))
    for _ in range(2):
        assert run_report.main(["resume_parsing", "--output-dir", str(tmp_path)]) == 1
    paths = list(tmp_path.glob("*.md"))
    assert len(paths) == 2
    report = paths[0].read_text()
    assert "synthetic provider outage" in report
    assert "runner failure after evaluation" in report
    assert "FAILED" in report


@pytest.mark.parametrize("suite,model", [
    ("library_retrieval", "openai:gpt-5-mini"),
    ("resume_parsing", "typesafe:jev-1.13.0"),
    ("tailoring", "openai:text-embedding-3-small"),
    ("user_text_screen", "openai:gpt-5-mini"),
    ("prompt_guardrail", "typesafe:jev-1.13.0"),
])
def test_model_validation(suite, model):
    """Rejects overrides incompatible with each runner's real model role."""
    with pytest.raises(ValueError):
        run_report.validate_model(suite, model)


def test_override_settings():
    """Keeps worker defaults unchanged and removes fallback contamination in comparisons."""
    original = load_settings()
    override = override_settings(original, "resume_parsing_model", "openai:gpt-5")
    assert override.resume_parsing_model == override.generative_fallback_model == "openai:gpt-5"
    assert original.resume_parsing_model != "openai:gpt-5"
    assert override_settings(original, "resume_parsing_model", None) is original
