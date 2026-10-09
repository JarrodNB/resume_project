"""
Description: Handles parse_job_posting tasks: screens the pasted ad, copies title, company, and
requirement lines out of it, and returns a ScrapedJobPosting. Safe to run twice (it only reads).
Index:
    - ParseJobPostingInput: the task's `input`, sent by Rails
    - BLOCKED_AD_MESSAGE / UNCHECKED_AD_MESSAGE / COULD_NOT_READ_MESSAGE: user-facing failures
    - handle_parse_job_posting_task: a completed result, or a failed result when the ad is
      blocked or has no title and company that appear in the text
"""

from pydantic import BaseModel, ValidationError
from pydantic_ai.exceptions import UnexpectedModelBehavior

from agents.parse_job_posting_agent import parse_job_posting
from job_postings.find_parsed_job_problems import find_parsed_job_problems
from job_postings.posting_from_parsed_job import posting_from_parsed_job
from screening.screen_user_text import ScreenOutcome, screen_user_text
from text_limits import SECTION_TOO_LONG_MESSAGE
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage, AiTaskMessage, ModelUsage
from worker.task_dependencies import TaskDependencies

BLOCKED_AD_MESSAGE = "This text was deemed unsafe, so it wasn't used. Edit it and try again."
UNCHECKED_AD_MESSAGE = "We couldn't check this job ad, so it wasn't used. Please try again."
COULD_NOT_READ_MESSAGE = "We couldn't find a job title and company in that text. Paste the full ad, or add the job manually."


class ParseJobPostingInput(BaseModel):
    """Input of a parse_job_posting task."""

    text: str


def handle_parse_job_posting_task(
    task: AiTaskMessage, dependencies: TaskDependencies
) -> AiResultMessage:
    """Screens the paste, parses it, and returns a ScrapedJobPosting."""
    try:
        text = ParseJobPostingInput.model_validate(task.input).text.strip()
    except ValidationError:
        return _failed(task, COULD_NOT_READ_MESSAGE)
    if not text:
        return _failed(task, COULD_NOT_READ_MESSAGE)

    settings = dependencies.settings
    screen = screen_user_text(
        text,
        model=settings.user_text_screen_model,
        timeout_seconds=settings.llm_run_timeout_seconds,
        check_phrases=False,
    )
    screen_usage = _screen_usage(screen)
    if not screen.allowed:
        return _failed(task, _screen_failure_message(screen), usage=screen_usage)

    model = settings.job_posting_parse_model
    try:
        run = parse_job_posting(
            text,
            model=model,
            thinking=settings.job_posting_parse_thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        )
    except UnexpectedModelBehavior:
        return _failed(task, COULD_NOT_READ_MESSAGE, usage=screen_usage)

    billed = run.model or model
    if find_parsed_job_problems(run.parsed, text):
        return _failed(
            task,
            COULD_NOT_READ_MESSAGE,
            usage=[build_model_usage(billed, run.usage), *screen_usage],
        )

    posting = posting_from_parsed_job(text, run.parsed)
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"scraped_job": posting.model_dump(mode="json")},
        usage=[build_model_usage(billed, run.usage), *screen_usage],
    )


def _screen_failure_message(screen: ScreenOutcome) -> str:
    """Too long, a screen that did not run, and a safety block each get their own reason."""
    if screen.too_long:
        return SECTION_TOO_LONG_MESSAGE
    if screen.unchecked:
        return UNCHECKED_AD_MESSAGE
    return BLOCKED_AD_MESSAGE


def _screen_usage(screen: ScreenOutcome) -> list[ModelUsage]:
    """Jev usage to report when a call was made."""
    if screen.usage is None or screen.model is None:
        return []
    return [build_model_usage(screen.model, screen.usage)]


def _failed(
    task: AiTaskMessage, error_message: str, usage: list[ModelUsage] | None = None
) -> AiResultMessage:
    """A failed result with a message the user sees."""
    return AiResultMessage(
        ai_task_id=task.ai_task_id, status="failed", error_message=error_message, usage=usage or []
    )
