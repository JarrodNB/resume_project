"""
Description: Read-only handlers for interview set generation and single-question replacement.
Index:
    - InterviewQuestionsInput: Rails queue snapshot with immutable general/technical scope
    - _library_evidence_text: original library strings for excerpt validation
    - handle_interview_questions_task: screens notes, checks context size, generates questions
"""
import json
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_questions_agent import generate_interview_questions
from gap_analysis.screen_library_facts import select_screened_facts
from schemas.interview_questions import InterviewQuestionContext, InterviewSetType
from screening.screen_user_text import screen_user_text
from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


class InterviewQuestionsInput(BaseModel):
    """Generation metadata or the immutable replacement snapshot from Rails."""

    question_set_id: UUID
    set_type: InterviewSetType = "general"
    question_id: UUID | None = None
    question_text: str = ""
    other_questions: list[str] = Field(default_factory=list)
    question_revision: int | None = None
    answer_revision: int | None = None


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
    library = dependencies.read_career_library(task.user_id).model_copy(deep=True)
    settings = dependencies.settings
    usage = []

    def screen_note(text: str):
        """Screens user-authored facts and retains their billed Jev usage."""
        outcome = screen_user_text(text, model=settings.user_text_screen_model,
                                   timeout_seconds=settings.llm_run_timeout_seconds)
        if outcome.usage is not None and outcome.model is not None:
            usage.append(build_model_usage(outcome.model, outcome.usage))
        return outcome

    # A fact's requirement came from a job posting; only the saved response is career evidence.
    library.facts = [fact.model_copy(update={"requirement": ""}) for fact in library.facts]
    library.facts, warnings = select_screened_facts(library.facts, screen_note)
    # Ignore IDs and dates when deciding whether the context has meaningful career content.
    content = library.model_dump(mode="json", exclude_none=True,
                                 exclude={"facts": {"__all__": {"requirement"}}})
    usable = bool(library.summary and library.summary.strip()) or any(
        value.strip() for rows, fields in (
            (library.experiences, ("title", "company", "description")),
            (library.projects, ("name", "description")),
            (library.educations, ("institution", "degree", "field_of_study")),
            (library.certifications, ("name",)), (library.skills, ("name",)),
            (library.facts, ("response",)),
        ) for row in rows for field in fields
        if isinstance(value := getattr(row, field), str)
    )
    if not usable:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="Add usable career details to your library before generating interview questions.")
    library_text = json.dumps(content, ensure_ascii=False)
    excluded = (snapshot.question_text, *snapshot.other_questions) if replacement else ()
    count = 1 if replacement else 5
    text = f"Generate {count} {snapshot.set_type} questions.\nLibrary JSON data:\n{library_text}"
    if excluded:
        text += "\nExcluded questions JSON data:\n" + json.dumps(excluded, ensure_ascii=False)
    if text_limits.prompt_is_too_long(text):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="Your career library is too long for interview questions. Shorten its entries and try again.")
    prompt = InterviewQuestionContext(text, _library_evidence_text(content), count, tuple(excluded), snapshot.set_type)
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


def _library_evidence_text(value: object) -> str:
    """Preserves original text for quote checks, including JSON-escaped newlines and quotes."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return "\n".join(_library_evidence_text(item) for key, item in value.items() if key != "id")
    if isinstance(value, list):
        return "\n".join(_library_evidence_text(item) for item in value)
    return ""
