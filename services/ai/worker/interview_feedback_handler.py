"""Coach an owned saved answer after checking its question and answer revisions.

Python reads the source once from its domain row, reuses exact saved approvals and
returns coaching only. Rails stores feedback against the reviewed revisions.
"""
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_feedback_agent import generate_interview_feedback
from llm.model_prices import build_model_usage, reported_model_name
from model_inputs.interview import format_feedback_prompt
from model_inputs.interview_evidence import interview_career_evidence
from schemas.interview_feedback import InterviewFeedbackContext
from schemas.interview_questions import InterviewSetType
from screening.library_inputs import LibraryScreeningError, rebuild_library, screen_library_inputs
from screening.record_adapters import interview_answer_record
from screening.records import screen_records_sync
from screening.session import bind_screened_prompt, trust_generated_source, within_screening_session
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


class InterviewFeedbackInput(BaseModel):
    """Owned source fields loaded together at the commanded revisions."""

    question_set_id: UUID
    set_type: InterviewSetType = "general"
    question_id: UUID
    question_text: str = Field(min_length=1)
    answer_text: str = Field(min_length=1, max_length=text_limits.MAX_INTERVIEW_ANSWER)
    question_revision: int = Field(ge=1)
    answer_revision: int = Field(ge=0)
    screened_fields: list[str] = Field(default_factory=list, exclude=True)


@within_screening_session
def handle_interview_feedback_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """Screens before model use; never writes the answer or career library."""
    if dependencies.read_interview_question_sources is None:
        raise RuntimeError("Interview question reader is not configured")
    sources = dependencies.read_interview_question_sources(task)
    if sources is None:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="This answer is out of date. Request feedback again.")
    saved = InterviewFeedbackInput.model_validate(sources)
    settings = dependencies.settings
    usage = []

    def fail(message):
        """Preserves billed screening and generation usage on expected failures."""
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=message, usage=usage)

    if not saved.answer_text.strip():
        return fail("Write an answer before asking for feedback.")
    source = saved.model_dump(mode="json")
    source["screened_fields"] = saved.screened_fields
    outcome = screen_records_sync([interview_answer_record(source, "answer_text", saved.answer_text)],
                                  approved_sources=[saved.answer_text]).decision
    usage.extend(outcome.model_usages)
    if not outcome.allowed:
        return fail("Your answer is saved. " + (
            "We couldn't check it right now. Try requesting feedback again." if outcome.unchecked else
            "We couldn't use it for AI feedback. Revise it and try again."))
    # The owned reader selects a saved generated question, never browser-supplied text.
    trust_generated_source(saved.question_text)
    if dependencies.read_career_library is None:
        raise RuntimeError("Career library reader is not configured")
    library = dependencies.read_career_library(task.user_id).model_copy(deep=True)
    try:
        selected = screen_library_inputs(library)
    except LibraryScreeningError as error:
        usage.extend(error.usage)
        return fail(f"Your answer is saved. Career library check failed ({error}). Review your library and try again.")
    usage.extend(selected.usage)
    library = selected.library
    warnings = list(selected.warnings)
    text = bind_screened_prompt(
        [saved.answer_text, saved.question_text, *selected.sources],
        lambda values: _feedback_prompt_text(values, selected.fields, saved.set_type),
    )
    if text_limits.prompt_is_too_long(text):
        return fail("Your answer is saved. Shorten your career library entries before requesting feedback.")
    context = InterviewFeedbackContext(text, saved.answer_text + "\n" + interview_career_evidence(library)[1], saved.set_type)
    try:
        with capture_run_messages() as messages:
            run = generate_interview_feedback(context, model=settings.interview_feedback_model,
                thinking=settings.interview_feedback_thinking,
                timeout_seconds=settings.llm_run_timeout_seconds,
                fallback_model=settings.generative_fallback_model)
    except UnexpectedModelBehavior:
        by_model: dict[str, RunUsage] = {}
        for message in messages:
            if isinstance(message, ModelResponse):
                model = reported_model_name(message.model_name or settings.interview_feedback_model,
                                            settings.interview_feedback_model)
                by_model.setdefault(model, RunUsage()).incr(message.usage)
        usage.extend(build_model_usage(model, tokens) for model, tokens in by_model.items())
        return fail("Your answer is saved. The AI couldn't produce valid feedback. Try again.")
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"interview_feedback": run.feedback.model_dump(mode="json"), "warnings": warnings},
        usage=[*usage, build_model_usage(run.model or settings.interview_feedback_model, run.usage)])


def _feedback_prompt_text(values, fields, set_type):
    """Render question, answer and library solely from supplied screened sources."""
    library = rebuild_library(values[2:], fields)
    return format_feedback_prompt(set_type, values[1], values[0], library)
