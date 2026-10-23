"""
Description: Imports a resume without sending detected contact to screening or parsing.
Downloads and extracts locally, validates original limits, prepares opaque PII replacements,
then selects the isolated structural importer or explicit legacy rollback. Both routes restore
structured output before source checks. Static spans time local stages without
recording document attributes or exceptions. Safe to run twice (it only reads).
Index:
    - SourceFile / ParseResumeInput: the task's `input`, sent by Rails
    - handle_parse_resume_task: returns a completed result with the faithfulness-checked
      ParsedResume and token usage, or a failed result when the file is unreadable or blocked
"""

from opentelemetry import trace
from pydantic import BaseModel
from pydantic_ai_harness import InputBlocked

from agents.resume_parsing_agent import parse_resume_text
from documents.enforce_source_faithfulness import enforce_source_faithfulness
from documents.extract_document_text import (
    DocumentTooLongError,
    UnsupportedDocumentError,
    extract_document_text,
)
from pii import PiiDetectionError, PiiRestorationError
from resume_import import import_resume_text
from screening.prompt_guardrail import UNCHECKED_MESSAGE
from screening.screen_user_text import ScreenOutcome, screen_user_text
from screening.session import within_screening_session
from text_limits import MAX_RESUME_TEXT, RESUME_TOO_LONG_MESSAGE
from worker.contact_mask import import_privacy_scope
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage, AiTaskMessage, ModelUsage
from worker.task_dependencies import TaskDependencies
from worker.task_usage import current_task_usage

_stage_tracer = trace.get_tracer(__name__)

UNREADABLE_FILE_MESSAGE = (
    "We couldn't read any text from this file. Upload a PDF or DOCX that isn't a scanned image."
)
BLOCKED_RESUME_MESSAGE = (
    "This resume was deemed unsafe, so it wasn't imported. Please edit the resume and try again."
)
RESUME_UNCHECKED_MESSAGE = "We couldn't check this resume, so it wasn't imported. Please try again."
RESUME_PRIVACY_MESSAGE = "We couldn't protect this resume's contact details, so it wasn't imported. Please try again."


class SourceFile(BaseModel):
    """The uploaded file as stored by Active Storage."""

    key: str
    filename: str
    content_type: str


class ParseResumeInput(BaseModel):
    """Input of a parse_resume task."""

    source_file: SourceFile


@within_screening_session
def handle_parse_resume_task(
    task: AiTaskMessage, dependencies: TaskDependencies
) -> AiResultMessage:
    """Parses the uploaded resume into a ParsedResume."""
    with import_privacy_scope() as privacy:
        try:
            return _parse_resume(task, dependencies, privacy)
        except (PiiDetectionError, PiiRestorationError):
            return AiResultMessage(
                ai_task_id=task.ai_task_id, status="failed", error_message=RESUME_PRIVACY_MESSAGE
            )


def _parse_resume(task, dependencies, privacy):
    """Coordinate local extraction, protected calls, restoration, and source checks."""
    task_input = ParseResumeInput.model_validate(task.input)
    # Timing spans deliberately omit exception details: early failures may contain
    # uploaded content before local privacy detection has run.
    with _stage_tracer.start_as_current_span(
        "resume_import.download", record_exception=False, set_status_on_exception=False
    ):
        file_bytes = dependencies.file_storage.download_file(task_input.source_file.key)

    try:
        with _stage_tracer.start_as_current_span(
            "resume_import.extract", record_exception=False, set_status_on_exception=False
        ):
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
    if len(resume_text) > MAX_RESUME_TEXT:
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message=RESUME_TOO_LONG_MESSAGE
        )
    with _stage_tracer.start_as_current_span(
        "resume_import.prepare_pii", record_exception=False, set_status_on_exception=False
    ):
        masked_text = privacy.prepare(resume_text)
    model = settings.resume_parsing_model
    if settings.resume_import_strategy == "structural":
        try:
            parsing_run = import_resume_text(
                masked_text,
                model=model,
                thinking=settings.resume_parsing_thinking,
                timeout_seconds=settings.llm_run_timeout_seconds,
                fallback_model=settings.generative_fallback_model,
            )
        except InputBlocked as error:
            # Screen failures remain actionable and never trigger a second importer.
            observed = current_task_usage()
            return AiResultMessage(
                ai_task_id=task.ai_task_id, status="failed",
                error_message=(RESUME_UNCHECKED_MESSAGE if str(error) == UNCHECKED_MESSAGE
                               else BLOCKED_RESUME_MESSAGE),
                usage=list(observed.entries) if observed else [],
            )
        usage = parsing_run.model_usages
    else:
        screen = _screen_resume_text(
            masked_text, settings.user_text_screen_model, settings.llm_run_timeout_seconds
        )
        screen_usage = _screen_usage(screen)
        if not screen.allowed:
            return AiResultMessage(
                ai_task_id=task.ai_task_id,
                status="failed",
                error_message=_screen_failure_message(screen),
                usage=screen_usage,
            )

        parsing_run = parse_resume_text(
            masked_text,
            model=model,
            thinking=settings.resume_parsing_thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        )
        usage = [*(getattr(parsing_run, "model_usages", None) or
                   [build_model_usage(parsing_run.model or model, parsing_run.usage)]), *screen_usage]
    with _stage_tracer.start_as_current_span(
        "resume_import.restore_and_check_source",
        record_exception=False,
        set_status_on_exception=False,
    ):
        try:
            restored = privacy.restore(parsing_run.parsed_resume)
        except PiiRestorationError:
            return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
                                   error_message=RESUME_PRIVACY_MESSAGE, usage=usage)
        parsed_resume = enforce_source_faithfulness(restored, resume_text)
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"parsed_resume": parsed_resume.model_dump(mode="json")},
        usage=usage,
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
    # The original extract was capped before preparation; opaque tokens can expand it.
    return screen_user_text(text, model=model, timeout_seconds=timeout_seconds,
                            check_phrases=False, max_characters=len(text))


def _screen_usage(screen: ScreenOutcome) -> list[ModelUsage]:
    """Classifier usage to report when a call was made. The phrase list makes none."""
    return screen.model_usages
