"""
Description: Optional Markdown reporting CLI for all existing eval suites and comparisons.
Index:
    - SUITES: existing suites and their configured model fields
    - validate_model: rejects incompatible provider/model families before any paid run
    - run_suite: invokes existing runner and preserves failures for the artifact
    - main: writes a collision-safe Markdown report and returns a failure status
"""

import argparse
import importlib
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from evals.report_capture import capture_run
from evals.report_markdown import render_report, report_errors
from worker.settings import load_settings

SUITES = {
    "resume_parsing": "resume_parsing_model",
    "job_posting_parse": "job_posting_parse_model",
    "job_posting_extraction": "job_requirements_sorting_model",
    "gap_analysis": "gap_analysis_model",
    "tailoring": "resume_tailoring_model",
    "interview_questions": "interview_questions_model",
    "interview_feedback": "interview_feedback_model",
    "library_retrieval": "embedding_model",
    "user_text_screen": "user_text_screen_model",
    "prompt_guardrail": "user_text_screen_model",
}


def validate_model(suite, model):
    """Requires the provider and model family supported by the existing suite."""
    if suite == "prompt_guardrail":
        raise ValueError("prompt_guardrail uses a fixed TestModel and configured Jev; no override")
    if suite == "user_text_screen":
        valid = model.startswith("typesafe:jev-")
        expected = "typesafe:jev-* decision model"
    elif suite == "library_retrieval":
        valid = model.startswith("openai:text-embedding-")
        expected = "openai:text-embedding-* embedding model"
    else:
        valid = model.startswith("openai:") and not model.startswith("openai:text-embedding-")
        expected = "openai:* generative model"
    if not valid:
        raise ValueError(f"{suite} requires an {expected}; got {model!r}")


def run_suite(suite, model=None):
    """Runs the unchanged suite pipeline with isolated capture and optional model override."""
    settings = load_settings()
    configured_model = model or getattr(settings, SUITES[suite])
    configuration = {
        "primary_model": configured_model,
        "override": model is not None,
        "screening_model": settings.user_text_screen_model,
        "thinking": getattr(settings, SUITES[suite].replace("_model", "_thinking"), None),
    }
    if suite == "library_retrieval":
        configuration["embedding_dimensions"] = settings.embedding_dimensions
    elif suite == "prompt_guardrail":
        configuration["generator"] = "TestModel (fixed fake generator)"
    elif suite != "user_text_screen":
        configuration["fallback_model"] = model or settings.generative_fallback_model
    error = None
    with capture_run() as capture:
        try:
            module = importlib.import_module(f"evals.run_{suite}_evals")
            runner = getattr(module, f"run_{suite}_evals")
            runner() if suite == "prompt_guardrail" else runner(model_override=model)
        except Exception as exception:  # noqa: BLE001 -- persist failures from any suite/provider
            error = f"{type(exception).__name__}: {exception}"
    configuration.update(capture.metadata)
    if configuration.get("fallback_model", configured_model) != configured_model:
        capture.costs.coverage_issues.append(
            "Fallback enabled: SDK request spans may omit failed intermediate attempts")
    return {"model": configured_model, "configuration": configuration,
            "report": capture.report, "error": error, "costs": capture.costs}


def main(argv=None):
    """Parses report options, runs one/two models, and persists even failed evaluations."""
    parser = argparse.ArgumentParser(description=__doc__.split("Index:")[0])
    parser.add_argument("suite", choices=SUITES)
    parser.add_argument("--model", action="append", default=[], metavar="PROVIDER:MODEL",
                        help="Override model; repeat once for a side-by-side comparison")
    parser.add_argument("--output-dir", type=Path,
                        default=Path("/docs/evals") if Path("/app").exists()
                        else Path(__file__).resolve().parents[3] / "docs/evals")
    args = parser.parse_args(argv)
    if len(args.model) > 2:
        parser.error("Pass at most two --model options")
    try:
        for model in args.model:
            validate_model(args.suite, model)
    except ValueError as exception:
        parser.error(str(exception))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    created = datetime.now(UTC)
    path = args.output_dir / f"{args.suite}-{created:%Y%m%dT%H%M%SZ}-{uuid4().hex}.md"
    runs = [run_suite(args.suite, model) for model in args.model or [None]]
    with path.open("x", encoding="utf-8") as output:
        output.write(render_report(args.suite, runs, created.isoformat()))
    print(f"Saved evaluation report: {path}")
    return int(any(run["error"] or report_errors(run["report"]) for run in runs))


if __name__ == "__main__":
    raise SystemExit(main())
