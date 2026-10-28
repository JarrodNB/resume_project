"""
Generate written interview questions from checked career evidence and saved preferences.

Input preparation keeps displayed evidence and citations together. This handler owns
task validation, source screening, model execution, and usage reporting; Rails saves results.
"""
from typing import Annotated
from uuid import UUID

import logfire
from pydantic import BaseModel, Field
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_questions_agent import generate_interview_questions
from llm.model_prices import build_model_usage, reported_model_name
from schemas.interview_questions import InterviewSetType
from screening.interview_question_inputs import prepare_interview_question_context
from screening.library_inputs import screen_library_inputs
from screening.screen_user_text import screen_user_text
from screening.session import trust_generated_source, within_screening_session
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


class InterviewQuestionsInput(BaseModel):
    """Generation metadata or the immutable replacement snapshot from Rails."""

    avoided_questions: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=50)
    question_set_id: UUID
    set_type: InterviewSetType = "general"
    question_id: UUID | None = None
    question_text: str = ""
    other_questions: list[str] = Field(default_factory=list)
    recent_questions: list[str] = Field(default_factory=list)
    question_revision: int | None = None
    answer_revision: int | None = None
    screened_fields: list[str] = Field(default_factory=list, exclude=True)
    other_question_snapshots: list[dict] = Field(default_factory=list, exclude=True)


@within_screening_session
def handle_interview_questions_task(
    task: AiTaskMessage, dependencies: TaskDependencies,
) -> AiResultMessage:
    """Returns drafts only; Rails will apply these atomically in the persistence task."""
    snapshot = InterviewQuestionsInput.model_validate(task.input)
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

    def screen_note(text: str):
        """Screens user-authored facts and retains their billed Jev usage."""
        outcome = screen_user_text(text, model=settings.user_text_screen_model,
                                   timeout_seconds=settings.llm_run_timeout_seconds)
        usage.extend(outcome.model_usages)
        return outcome

    # Screen requirement context too; only the saved response receives an evidence ID.
    with logfire.span("interview_questions.screen_career_library"):
        selected = screen_library_inputs(library, screen_note)
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
    # Every excluded question arrives in this internal task from Rails-owned generated slots.
    # Legacy snapshots may lack aligned sibling metadata, but that does not make our own
    # generated question text user-authored or a reason to screen it again.
    for question in excluded:
        trust_generated_source(question)
    # This immutable Rails field comes only from preferences saved using owned, generated
    # question/message records. It never accepts arbitrary browser text or user edits.
    for question in snapshot.avoided_questions:
        trust_generated_source(question)
    excluded = tuple(dict.fromkeys((*excluded, *snapshot.avoided_questions)))
    count = 1 if replacement else 5
    # Like exclusions, these are Rails-owned generated slots with no user-edit path.
    # Recent practice is soft guidance and never joins the hard exclusion list.
    recent = [] if replacement else snapshot.recent_questions
    for question in recent:
        trust_generated_source(question)
    with logfire.span("interview_questions.build_prompt"):
        prompt = prepare_interview_question_context(
            selected, excluded, count, snapshot.set_type, recent_questions=recent,
        )
        if text_limits.prompt_is_too_long(prompt.text):
            return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                error_message="Your career library and saved question preferences are too long for interview questions. Shorten your library entries and try again.")
    try:
        with capture_run_messages() as messages:
            run = generate_interview_questions(prompt, model=settings.interview_questions_model,
                thinking=settings.interview_questions_thinking,
                timeout_seconds=settings.llm_run_timeout_seconds,
                fallback_model=settings.generative_fallback_model)
    except UnexpectedModelBehavior:
        # Validation retries still consume tokens, even when no valid output is returned.
        by_model: dict[str, RunUsage] = {}
        for message in messages:
            if isinstance(message, ModelResponse):
                model = reported_model_name(message.model_name or settings.interview_questions_model,
                                            settings.interview_questions_model)
                by_model.setdefault(model, RunUsage()).incr(message.usage)
        usage.extend(build_model_usage(model, tokens) for model, tokens in by_model.items())
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="The AI could not produce valid, distinct questions. Try generating again.")
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"interview_questions": run.questions.model_dump(mode="json"), "warnings": warnings},
        usage=[*usage, build_model_usage(run.model or settings.interview_questions_model, run.usage)])
