"""
Description: Runs the job posting extraction evals (heading split, plus the real requirements
sorting agent where headings don't match) and reports the average of each score to Langfuse.
Run: docker compose run --rm ai python -m evals.run_job_posting_extraction_evals
Index:
    - load_job_posting_extraction_dataset: reads the YAML cases with the custom evaluators
    - linkedin_case_to_page: the JobPage the LinkedIn scraper would build from a case's inputs
    - run_job_posting_extraction_evals: evaluates every case, prints the report, scores the trace
"""

from pathlib import Path
from typing import Any

from langfuse import get_client, propagate_attributes
from pydantic_evals import Dataset

from agents.job_requirements_sorting_agent import sort_job_requirement_bullets
from evals.job_posting_extraction_evaluators import JOB_POSTING_EXTRACTION_EVALUATORS
from job_postings.extract_job_posting import BulletSortingRun, extract_job_posting
from prompts.job_requirements_sorting_instructions import JOB_REQUIREMENTS_SORTING_PROMPT_VERSION
from schemas.scraped_job_posting import ScrapedJobPosting
from scrapers.job_page import JobPage
from scrapers.linkedin.linkedin_description_to_html import linkedin_description_to_html
from scrapers.linkedin.parse_linkedin_job_url import linkedin_job_url
from worker.settings import load_settings
from worker.tracing import configure_tracing

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


def run_job_posting_extraction_evals() -> None:
    """Evaluates extraction on every case and records the average scores in Langfuse."""
    settings = load_settings()
    configure_tracing()
    langfuse = get_client()
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

    with (
        langfuse.start_as_current_observation(
            name=TRACE_NAME,
            metadata={
                "model": model,
                "thinking": thinking,
                "prompt_version": JOB_REQUIREMENTS_SORTING_PROMPT_VERSION,
            },
        ),
        propagate_attributes(
            trace_name=TRACE_NAME,
            version=JOB_REQUIREMENTS_SORTING_PROMPT_VERSION,
            tags=["eval", "scrape_job", model, f"thinking:{thinking}"],
        ),
    ):
        report = load_job_posting_extraction_dataset().evaluate_sync(
            extract_case,
            name=f"job_posting_extraction:{model}:thinking={thinking}",
            max_concurrency=5,
        )
        for score_name, average in report.averages().scores.items():
            langfuse.score_current_trace(name=score_name, value=average)

    report.print(include_input=False, include_output=False, include_durations=True)
    langfuse.flush()


if __name__ == "__main__":
    run_job_posting_extraction_evals()
