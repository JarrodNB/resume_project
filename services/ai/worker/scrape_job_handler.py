"""Build a job from a scraped ad using the same source-checked parser as pasted ads.

Parse only the selected posting text, without injection classification, tools or
private context, and preserve the scraper's metadata and source URL. Rails owns
saving the result. Repeated deliveries remain read-only here.
"""

from pydantic import BaseModel
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai_harness import InputBlocked

from agents.parse_scraped_job_posting_agent import parse_scraped_job_posting
from job_postings.scraped_job_ad import posting_from_scraped_ad, scraped_job_ad_text
from llm.model_prices import build_model_usage
from schemas.model_usage import ModelUsage
from scrapers.job_page import (
    JobPageUnreadableError,
    JobPostingNotFoundError,
    UnsupportedJobUrlError,
)
from scrapers.job_site_registry import find_job_site_scraper
from screening.session import within_screening_session
from text_limits import JOB_AD_TOO_LONG_MESSAGE, MAX_SCREENED_TEXT
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies

UNSUPPORTED_URL_MESSAGE = (
    "This link isn't a LinkedIn job posting. Open the job on LinkedIn and copy its link "
    "(linkedin.com/jobs/view/...)."
)
POSTING_NOT_FOUND_MESSAGE = "We couldn't find this job posting. It may have closed."
UNREADABLE_PAGE_MESSAGE = "We couldn't read this job posting. Please try again in a few minutes."
UNFAITHFUL_PAGE_MESSAGE = (
    "We couldn't extract faithful details from this posting. Paste the full ad, or add the job manually."
)


class ScrapeJobInput(BaseModel):
    """Input of a scrape_job task."""

    url: str


@within_screening_session
def handle_scrape_job_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """Scrapes the job posting at the task's URL into a ScrapedJobPosting."""
    url = ScrapeJobInput.model_validate(task.input).url
    scraper = find_job_site_scraper(url)
    if scraper is None:
        return _failed(task, UNSUPPORTED_URL_MESSAGE)

    try:
        page = scraper.scrape(url, dependencies.http_client)
        text = scraped_job_ad_text(page)
    except UnsupportedJobUrlError:
        return _failed(task, UNSUPPORTED_URL_MESSAGE)
    except JobPostingNotFoundError:
        return _failed(task, POSTING_NOT_FOUND_MESSAGE)
    except JobPageUnreadableError:
        return _failed(task, UNREADABLE_PAGE_MESSAGE)

    settings = dependencies.settings
    model = settings.job_posting_parse_model
    if len(text) > MAX_SCREENED_TEXT:
        return _failed(task, JOB_AD_TOO_LONG_MESSAGE)
    usage: list[ModelUsage] = []

    try:
        run = parse_scraped_job_posting(
            text, model=model, thinking=settings.job_posting_parse_thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        )
    except UnexpectedModelBehavior:
        return _failed(task, UNFAITHFUL_PAGE_MESSAGE, usage=usage)
    except InputBlocked as error:
        return _failed(task, str(error), usage=usage)
    usage.insert(0, build_model_usage(run.model or model, run.usage))
    try:
        posting = posting_from_scraped_ad(page, run.parsed)
    except ValueError:
        return _failed(task, UNFAITHFUL_PAGE_MESSAGE, usage=usage)
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"scraped_job": posting.model_dump(mode="json")},
        usage=usage,
    )


def _failed(task: AiTaskMessage, error_message: str, *, usage: list[ModelUsage] | None = None) -> AiResultMessage:
    """A failed result with a message the user sees."""
    return AiResultMessage(
        ai_task_id=task.ai_task_id, status="failed", error_message=error_message, usage=usage or [],
    )
