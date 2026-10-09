"""
Description: Handles parse_resume tasks: downloads the uploaded file, extracts its text, screens
it, runs the resume parsing agent, and checks its output against the text. Safe to run twice
(it only reads).
Index:
    - SourceFile / ParseResumeInput: the task's `input`, sent by Rails
    - handle_parse_resume_task: returns a completed result with the faithfulness-checked
      ParsedResume and token usage, or a failed result when the file is unreadable or blocked
"""

from pydantic import BaseModel

from agents.resume_parsing_agent import parse_resume_text
from documents.enforce_source_faithfulness import enforce_source_faithfulness
from documents.extract_document_text import (
    DocumentTooLongError,
    UnsupportedDocumentError,
    extract_document_text,
)
from screening.screen_user_text import ScreenOutcome, screen_user_text
from text_limits import RESUME_TOO_LONG_MESSAGE
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage, AiTaskMessage, ModelUsage
from worker.task_dependencies import TaskDependencies

UNREADABLE_FILE_MESSAGE = (
    "We couldn't read any text from this file. Upload a PDF or DOCX that isn't a scanned image."
)
BLOCKED_RESUME_MESSAGE = (
    "This resume was deemed unsafe, so it wasn't imported. Please edit the resume and try again."
)
RESUME_UNCHECKED_MESSAGE = "We couldn't check this resume, so it wasn't imported. Please try again."


class SourceFile(BaseModel):
    """The uploaded file as stored by Active Storage."""

    key: str
    filename: str
    content_type: str


class ParseResumeInput(BaseModel):
    """Input of a parse_resume task."""

    source_file: SourceFile


def handle_parse_resume_task(
    task: AiTaskMessage, dependencies: TaskDependencies
) -> AiResultMessage:
    """Parses the uploaded resume into a ParsedResume."""
    task_input = ParseResumeInput.model_validate(task.input)
    file_bytes = dependencies.file_storage.download_file(task_input.source_file.key)

    try:
        resume_text = extract_document_text(file_bytes, task_input.source_file.content_type)
    except DocumentTooLongError:
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message=RESUME_TOO_LONG_MESSAGE
        )
    except UnsupportedDocumentError:
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message=UNREADABLE_FILE_MESSAGE
        )

    settings = dependencies.settings
    screen = _screen_resume_text(
        resume_text, settings.user_text_screen_model, settings.llm_run_timeout_seconds
    )
    screen_usage = _screen_usage(screen)
    if not screen.allowed:
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message=_screen_failure_message(screen),
            usage=screen_usage,
        )

    model = settings.resume_parsing_model
    parsing_run = parse_resume_text(
        resume_text,
        model=model,
        thinking=settings.resume_parsing_thinking,
        timeout_seconds=settings.llm_run_timeout_seconds,
        fallback_model=settings.generative_fallback_model,
    )
    parsed_resume = enforce_source_faithfulness(parsing_run.parsed_resume, resume_text)
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"parsed_resume": parsed_resume.model_dump(mode="json")},
        usage=[build_model_usage(parsing_run.model or model, parsing_run.usage), *screen_usage],
    )


def _screen_failure_message(screen: ScreenOutcome) -> str:
    """Too long, a screen that did not run, and a safety block each get their own reason."""
    if screen.too_long:
        return RESUME_TOO_LONG_MESSAGE
    if screen.unchecked:
        return RESUME_UNCHECKED_MESSAGE
    return BLOCKED_RESUME_MESSAGE


def _screen_resume_text(text: str, model: str, timeout_seconds: float) -> ScreenOutcome:
    """Screens the extracted resume before it can enter the parsing prompt. The phrase list
    is for one note; Jev judges the whole file."""
    return screen_user_text(text, model=model, timeout_seconds=timeout_seconds, check_phrases=False)


def _screen_usage(screen: ScreenOutcome) -> list[ModelUsage]:
    """Jev usage to report when a call was made. The phrase list makes none."""
    if screen.usage is None or screen.model is None:
        return []
    return [build_model_usage(screen.model, screen.usage)]
