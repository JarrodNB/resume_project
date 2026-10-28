"""
Description: Handles scrape_job tasks: scrapes the posting with the site's deterministic scraper,
then splits out requirements (headings first, the sorting agent only as a fallback). Safe to run
twice (it only reads).
Index:
    - ScrapeJobInput: the task's `input`, sent by Rails
    - UNSUPPORTED_URL_MESSAGE / POSTING_NOT_FOUND_MESSAGE / UNREADABLE_PAGE_MESSAGE: user-facing
      failure messages
    - handle_scrape_job_task: returns a completed result with the ScrapedJobPosting (and the
      sorting agent's usage if it ran), or a failed result for unsupported, missing, or
      unreadable postings
"""

from pydantic import BaseModel
from pydantic_ai_harness import InputBlocked

from agents.job_requirements_sorting_agent import (
    format_numbered_bullets,
    sort_job_requirement_bullets,
)
from job_postings.extract_job_posting import BulletSortingRun, extract_job_posting
from llm.model_prices import build_model_usage
from schemas.model_usage import ModelUsage
from scrapers.job_page import (
    JobPageUnreadableError,
    JobPostingNotFoundError,
    UnsupportedJobUrlError,
)
from scrapers.job_site_registry import find_job_site_scraper
from screening.prompt_guardrail import BLOCKED_MESSAGE, TOO_LONG_MESSAGE, UNCHECKED_MESSAGE
from screening.screen_user_text import screen_user_text
from screening.session import within_screening_session
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies

UNSUPPORTED_URL_MESSAGE = (
    "This link isn't a LinkedIn job posting. Open the job on LinkedIn and copy its link "
    "(linkedin.com/jobs/view/...)."
)
POSTING_NOT_FOUND_MESSAGE = "We couldn't find this job posting. It may have closed."
UNREADABLE_PAGE_MESSAGE = "We couldn't read this job posting. Please try again in a few minutes."


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
    except UnsupportedJobUrlError:
        return _failed(task, UNSUPPORTED_URL_MESSAGE)
    except JobPostingNotFoundError:
        return _failed(task, POSTING_NOT_FOUND_MESSAGE)
    except JobPageUnreadableError:
        return _failed(task, UNREADABLE_PAGE_MESSAGE)

    settings = dependencies.settings
    model = settings.job_requirements_sorting_model
    screen_usage: list[ModelUsage] = []

    def sort_bullets(bullets: list[str]) -> BulletSortingRun:
        """Screen exactly the numbered source consumed by the sorting agent."""
        screen = screen_user_text(
            format_numbered_bullets(bullets), model=settings.user_text_screen_model,
            timeout_seconds=settings.llm_run_timeout_seconds, check_phrases=False,
        )
        screen_usage.extend(screen.model_usages)
        if not screen.allowed:
            raise InputBlocked(
                TOO_LONG_MESSAGE if screen.too_long else UNCHECKED_MESSAGE if screen.unchecked else BLOCKED_MESSAGE
            )
        return sort_job_requirement_bullets(
            bullets,
            model=model,
            thinking=settings.job_requirements_sorting_thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        )

    try:
        extraction = extract_job_posting(page, sort_bullets)
    except InputBlocked as error:
        return _failed(task, str(error), usage=screen_usage)
    usage = (
        [build_model_usage(extraction.sorting_model or model, extraction.sorting_usage)]
        if extraction.sorting_usage
        else []
    )
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"scraped_job": extraction.posting.model_dump(mode="json")},
        usage=[*usage, *screen_usage],
    )


def _failed(task: AiTaskMessage, error_message: str, *, usage: list[ModelUsage] | None = None) -> AiResultMessage:
    """A failed result with a message the user sees."""
    return AiResultMessage(
        ai_task_id=task.ai_task_id, status="failed", error_message=error_message, usage=usage or [],
    )
