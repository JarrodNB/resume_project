"""
Description: Runs the job posting extraction evals (heading split, plus the real requirements
sorting agent where headings don't match) and reports the average of each score to Logfire.
Run: docker compose run --rm ai python -m evals.run_job_posting_extraction_evals
Index:
    - load_job_posting_extraction_dataset: reads the YAML cases with the custom evaluators
    - linkedin_case_to_page: the JobPage the LinkedIn scraper would build from a case's inputs
    - run_job_posting_extraction_evals: evaluates every case, prints the report, scores the trace
"""

from pathlib import Path
from typing import Any

from pydantic_evals import Dataset
from pydantic_evals.reporting import EvaluationReport

from agents.job_requirements_sorting_agent import sort_job_requirement_bullets
from evals.job_posting_extraction_evaluators import JOB_POSTING_EXTRACTION_EVALUATORS
from evals.report_capture import override_settings
from evals.telemetry import evaluate_dataset
from job_postings.extract_job_posting import BulletSortingRun, extract_job_posting
from prompts.job_requirements_sorting_instructions import JOB_REQUIREMENTS_SORTING_PROMPT_VERSION
from schemas.scraped_job_posting import ScrapedJobPosting
from scrapers.job_page import JobPage
from scrapers.linkedin.linkedin_description_to_html import linkedin_description_to_html
from scrapers.linkedin.parse_linkedin_job_url import linkedin_job_url
from worker.settings import load_settings

DATASET_PATH = Path(__file__).parent / "datasets" / "job_posting_extraction_cases.yaml"
TRACE_NAME = "evals.job_posting_extraction"


def load_job_posting_extraction_dataset() -> Dataset[
    dict[str, Any], ScrapedJobPosting, dict[str, Any]
]:
    """Loads the labelled job posting cases."""
    return Dataset[dict[str, Any], ScrapedJobPosting, dict[str, Any]].from_file(
        DATASET_PATH, custom_evaluator_types=JOB_POSTING_EXTRACTION_EVALUATORS
    )


def linkedin_case_to_page(inputs: dict[str, Any]) -> JobPage:
    """Cases store the top card fields and the raw description markup, as found on the page."""
    return JobPage(
        source="linkedin",
        source_url=linkedin_job_url(inputs["job_id"]),
        title=inputs["title"],
        company=inputs["company"],
        location=inputs.get("location"),
        description_html=linkedin_description_to_html(inputs["description_html"]),
    )


def run_job_posting_extraction_evals(model_override: str | None = None) -> EvaluationReport:
    """Evaluates extraction on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "job_requirements_sorting_model", model_override)
    model = settings.job_requirements_sorting_model
    thinking = settings.job_requirements_sorting_thinking

    def sort_bullets(bullets: list[str]) -> BulletSortingRun:
        """The real sorting agent, as the worker runs it."""
        return sort_job_requirement_bullets(
            bullets,
            model=model,
            thinking=thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        )

    def extract_case(inputs: dict[str, Any]) -> ScrapedJobPosting:
        """The task under evaluation."""
        return extract_job_posting(linkedin_case_to_page(inputs), sort_bullets).posting

    return evaluate_dataset(
        load_job_posting_extraction_dataset,
        extract_case,
        name=TRACE_NAME,
        metadata={
            "model": model,
            "thinking": thinking,
            "prompt_version": JOB_REQUIREMENTS_SORTING_PROMPT_VERSION,
        },
        version=JOB_REQUIREMENTS_SORTING_PROMPT_VERSION,
        tags=["eval", "scrape_job", model, f"thinking:{thinking}"],
        evaluation_name=f"job_posting_extraction:{model}:thinking={thinking}",
        max_concurrency=5,
    )


if __name__ == "__main__":
    run_job_posting_extraction_evals()
