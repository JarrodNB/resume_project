"""
Generate written interview questions from checked career evidence and saved preferences.

Input preparation keeps displayed evidence and citations together. This handler owns
task validation, source screening, model execution, and usage reporting; Rails saves results.
"""
from typing import Annotated
from uuid import UUID

import logfire
from pydantic import BaseModel, Field

import text_limits
from agents.interview_questions_agent import generate_interview_questions
from llm.run_generative_agent import GenerativeOutputInvalid
from schemas.interview_questions import InterviewSetType
from screening.interview_question_inputs import prepare_interview_question_context
from screening.library_inputs import LibraryScreeningError, screen_library_inputs
from screening.record_adapters import interview_question_records
from screening.records import screen_records_sync
from screening.session import within_screening_session
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


class InterviewQuestionsInput(BaseModel):
    """Current owned question sources selected by the database reader."""

    question_sources: list[dict] = Field(default_factory=list)
    avoided_question_sources: list[dict] = Field(default_factory=list)
    avoided_questions: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=50)
    question_set_id: UUID
    set_type: InterviewSetType = "fit_motivation"
    question_id: UUID | None = None
    question_text: str = ""
    other_questions: list[str] = Field(default_factory=list)
    recent_questions: list[str] = Field(default_factory=list)
    question_revision: int | None = None
    answer_revision: int | None = None


@within_screening_session
def handle_interview_questions_task(
    task: AiTaskMessage, dependencies: TaskDependencies,
) -> AiResultMessage:
    """Returns drafts only; Rails will apply these atomically in the persistence task."""
    if dependencies.read_interview_question_sources is None:
        raise RuntimeError("Interview question reader is not configured")
    sources = dependencies.read_interview_question_sources(task)
    if sources is None:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="These questions are out of date. Request generation again.")
    snapshot = InterviewQuestionsInput.model_validate(sources)
    replacement = task.task_type == "regenerate_interview_question"
    if replacement and (not snapshot.question_id or not snapshot.question_text.strip()
                        or len(snapshot.other_questions) != 4):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
                               error_message="Reload this question set and request replacement again.")
    if dependencies.read_career_library is None:
        raise RuntimeError("Career library reader is not configured")
    with logfire.span("interview_questions.load_career_library"):
        library = dependencies.read_career_library(task.user_id).model_copy(deep=True)
    settings = dependencies.settings
    usage = []
    # Screen requirement context too; only the saved response receives an evidence ID.
    with logfire.span("interview_questions.screen_career_library"):
        try:
            selected = screen_library_inputs(library)
        except LibraryScreeningError as error:
            usage.extend(error.usage)
            return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                error_message=f"Career library check failed ({error}). Review your library and try again.")
    usage.extend(selected.usage)
    library = selected.library
    warnings = list(selected.warnings)
    # Ignore IDs and dates when deciding whether the context has meaningful career content.
    usable = bool(library.summary and library.summary.strip()) or any(
        value.strip() for rows, fields in (
            (library.experiences, ("title", "company", "description")),
            (library.projects, ("name", "description")),
            (library.educations, ("institution", "degree", "field_of_study")),
            (library.certifications, ("name",)), (library.skills, ("name",)),
            (library.career_contexts, ("response",)),
        ) for row in rows for field in fields
        if isinstance(value := getattr(row, field), str)
    )
    if not usable:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="Add usable career details to your library before generating interview questions.")
    excluded = (snapshot.question_text, *snapshot.other_questions) if replacement else ()
    recent = [] if replacement else snapshot.recent_questions
    descriptors = [*snapshot.question_sources, *snapshot.avoided_question_sources]
    if {r["question_text"] for r in descriptors} != {*excluded, *snapshot.avoided_questions, *recent}:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="Question provenance is unavailable. Reload and try again.")
    records = [*interview_question_records(snapshot.question_sources),
               *interview_question_records(snapshot.avoided_question_sources, avoided=True)]
    if records:
        outcome = screen_records_sync(records, approved_sources=[
            value for record in records for value in record.fields.values()]).decision
        usage.extend(outcome.model_usages)
        if not outcome.allowed:
            return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                error_message="We could not check your custom questions. Revise them or try again.")
    excluded = tuple(dict.fromkeys((*excluded, *snapshot.avoided_questions)))
    count = 1 if replacement else 5
    with logfire.span("interview_questions.build_prompt"):
        prompt = prepare_interview_question_context(
            selected, excluded, count, snapshot.set_type, recent_questions=recent,
        )
        if text_limits.prompt_is_too_long(prompt.text):
            return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                error_message="Your career library and saved question preferences are too long for interview questions. Shorten your library entries and try again.")
    try:
        questions = generate_interview_questions(prompt, model=settings.interview_questions_model,
            thinking=settings.interview_questions_thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model)
    except GenerativeOutputInvalid:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="The AI could not produce valid, distinct questions. Try generating again.")
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"interview_questions": questions.model_dump(mode="json"), "warnings": warnings},
        usage=usage)
