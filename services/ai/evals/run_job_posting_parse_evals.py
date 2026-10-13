"""
Description: Runs the pasted job-ad parse evals (the real parse agent, then the same posting
builder the handler uses) and reports the average of each score to Logfire.
Run: docker compose run --rm ai python -m evals.run_job_posting_parse_evals
Index:
    - load_job_posting_parse_dataset: reads the YAML cases with the custom evaluators
    - run_job_posting_parse_evals: evaluates every case, prints the report, scores the trace
"""

from pathlib import Path
from typing import Any

from pydantic_evals import Dataset

from agents.parse_job_posting_agent import parse_job_posting
from evals.job_posting_parse_evaluators import JOB_POSTING_PARSE_EVALUATORS
from evals.report_capture import capture_report, override_settings
from evals.telemetry import eval_run, record_score
from job_postings.posting_from_parsed_job import posting_from_parsed_job
from prompts.parse_job_posting_instructions import PARSE_JOB_POSTING_PROMPT_VERSION
from schemas.scraped_job_posting import ScrapedJobPosting
from worker.settings import load_settings
from worker.tracing import configure_tracing

DATASET_PATH = Path(__file__).parent / "datasets" / "job_posting_parse_cases.yaml"
TRACE_NAME = "evals.job_posting_parse"


def load_job_posting_parse_dataset() -> Dataset[dict[str, Any], ScrapedJobPosting, dict[str, Any]]:
    """Loads the labelled pasted-ad cases."""
    return Dataset[dict[str, Any], ScrapedJobPosting, dict[str, Any]].from_file(
        DATASET_PATH, custom_evaluator_types=JOB_POSTING_PARSE_EVALUATORS
    )


def run_job_posting_parse_evals(model_override: str | None = None) -> None:
    """Evaluates parsing on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "job_posting_parse_model", model_override)
    configure_tracing()
    model = settings.job_posting_parse_model
    thinking = settings.job_posting_parse_thinking

    def parse_case(inputs: dict[str, Any]) -> ScrapedJobPosting:
        """The task under evaluation: the agent, then the production posting builder."""
        text = str(inputs["text"])
        parsed = parse_job_posting(
            text,
            model=model,
            thinking=thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        ).parsed
        return posting_from_parsed_job(text, parsed)

    with eval_run(
        name=TRACE_NAME,
        metadata={
            "model": model,
            "thinking": thinking,
            "prompt_version": PARSE_JOB_POSTING_PROMPT_VERSION,
        },
        version=PARSE_JOB_POSTING_PROMPT_VERSION,
        tags=["eval", "parse_job_posting", model, f"thinking:{thinking}"],
    ):
        report = load_job_posting_parse_dataset().evaluate_sync(
            parse_case,
            name=f"job_posting_parse:{model}:thinking={thinking}",
            max_concurrency=4,
        )
        capture_report(report)
        for score_name, average in report.averages().scores.items():
            record_score(name=score_name, value=average)

    report.print(include_input=False, include_output=False, include_durations=True)


if __name__ == "__main__":
    run_job_posting_parse_evals()
