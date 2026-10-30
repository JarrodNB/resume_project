"""Evaluate structured jobs built from selected scraped HTML and the shared ad parser.

Cases exercise the same source rendering and validation as scrape-job tasks.
Source-boundary guards remain active; labels never enter parser inputs.
The optional screened comparison is isolated to this eval process.
"""

from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Any
from unittest.mock import patch

from pydantic_ai_harness import InputGuardrail
from pydantic_evals import Dataset
from pydantic_evals.reporting import EvaluationReport

from agents.parse_scraped_job_posting_agent import (
    parse_scraped_job_posting,
    parse_scraped_job_posting_agent,
)
from evals.job_posting_extraction_evaluators import JOB_POSTING_EXTRACTION_EVALUATORS
from evals.report_capture import override_settings
from evals.telemetry import evaluate_dataset
from job_postings.scraped_job_ad import posting_from_scraped_ad, scraped_job_ad_text
from prompts.parse_job_posting_instructions import PARSE_JOB_POSTING_PROMPT_VERSION
from schemas.scraped_job_posting import ScrapedJobPosting
from scrapers.job_page import JobPage, JobPageUnreadableError
from scrapers.linkedin.linkedin_description_to_html import linkedin_description_to_html
from scrapers.linkedin.parse_linkedin_job_url import linkedin_job_url
from scrapers.public_job_page import public_job_html_to_page
from screening.prompt_guardrail import screen_prompt
from settings import load_settings
from text_limits import MAX_SCREENED_TEXT

DATASET_PATH = Path(__file__).parent / "datasets" / "job_posting_extraction_cases.yaml"
TRACE_NAME = "evals.job_posting_extraction"


def load_job_posting_extraction_dataset(path: Path = DATASET_PATH) -> Dataset[
    dict[str, Any], ScrapedJobPosting | None, dict[str, Any]
]:
    """Loads the labelled job posting cases."""
    return Dataset[dict[str, Any], ScrapedJobPosting | None, dict[str, Any]].from_file(
        path, custom_evaluator_types=JOB_POSTING_EXTRACTION_EVALUATORS
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


@contextmanager
def with_extraction_screening():
    """Temporarily add the previous classifier policy for an isolated comparison.

    Keep logging, source validators, model/deadline limits and actual accounting.
    Restore the existing guard even after validation or provider failures. This is
    not used by worker code and must not run alongside ordinary evaluations.
    """
    guards = [cap for cap in parse_scraped_job_posting_agent._root_capability.capabilities
              if isinstance(cap, InputGuardrail)]
    if len(guards) != 1:
        raise RuntimeError("Expected exactly one extraction input guard")
    with patch.object(guards[0], "guard", screen_prompt):
        yield


def run_job_posting_extraction_evals(
    model_override: str | None = None, *, dataset_path: Path = DATASET_PATH,
    screening_enabled: bool = False,
) -> EvaluationReport:
    """Evaluates extraction on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "job_posting_parse_model", model_override)
    model = settings.job_posting_parse_model
    thinking = settings.job_posting_parse_thinking

    def extract_case(inputs: dict[str, Any]) -> ScrapedJobPosting | None:
        """Run the production renderer, parser and source-checked builder."""
        try:
            page = (public_job_html_to_page(inputs["page_html"], inputs["url"])
                    if "page_html" in inputs else linkedin_case_to_page(inputs))
        except JobPageUnreadableError:
            return None
        text = scraped_job_ad_text(page)
        if len(text) > MAX_SCREENED_TEXT:
            raise ValueError("Extraction input exceeds its size budget")
        run = parse_scraped_job_posting(
            text, model=model, thinking=thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        )
        try:
            return posting_from_scraped_ad(page, run.parsed)
        except JobPageUnreadableError:
            return None

    with (with_extraction_screening() if screening_enabled else nullcontext()):
        return evaluate_dataset(
            lambda: load_job_posting_extraction_dataset(dataset_path),
            extract_case,
            name=TRACE_NAME,
            metadata={
                "model": model,
                "thinking": thinking,
                "prompt_version": PARSE_JOB_POSTING_PROMPT_VERSION,
                "screening_enabled": screening_enabled,
                "dataset": dataset_path.name,
            },
            version=PARSE_JOB_POSTING_PROMPT_VERSION,
            tags=["eval", "scrape_job", model, f"thinking:{thinking}"],
            evaluation_name=f"job_posting_extraction:{model}:thinking={thinking}",
            max_concurrency=5,
        )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=None)
    parser.add_argument("--adversarial", action="store_true")
    parser.add_argument("--public-pages", action="store_true")
    parser.add_argument("--with-screening", action="store_true")
    args = parser.parse_args()
    run_job_posting_extraction_evals(
        model_override=args.model,
        dataset_path=(DATASET_PATH.with_name("job_posting_public_page_cases.yaml") if args.public_pages else
                      DATASET_PATH.with_name("job_posting_injection_cases.yaml") if args.adversarial else DATASET_PATH),
        screening_enabled=args.with_screening,
    )
