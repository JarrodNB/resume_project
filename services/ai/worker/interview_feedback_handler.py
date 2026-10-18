"""Coach a saved interview answer without changing it or the career library.

Screens exact question, answer, and optional career evidence before generation. Only trusted
saved snapshots can reuse earlier checks; Rails keeps feedback tied to its saved revisions.
"""
import json
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_feedback_agent import generate_interview_feedback
from schemas.interview_feedback import InterviewFeedbackContext
from schemas.interview_questions import InterviewSetType
from screening.library_inputs import library_source_values, rebuild_library, screen_library_inputs
from screening.saved_sources import register_saved_sources
from screening.screen_user_text import screen_user_text
from screening.session import bind_screened_prompt, within_screening_session
from worker.interview_questions_handler import _library_evidence_text
from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


class InterviewFeedbackInput(BaseModel):
    """Question and answer revisions saved before queue publication."""

    saved_input_snapshot: Literal["interview_question_v1"] | None = None
    question_set_id: UUID
    set_type: InterviewSetType = "general"
    question_id: UUID
    question_text: str = Field(min_length=1)
    answer_text: str = Field(min_length=1, max_length=text_limits.MAX_INTERVIEW_ANSWER)
    question_revision: int = Field(ge=1)
    answer_revision: int = Field(ge=0)


@within_screening_session
def handle_interview_feedback_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """Screens before model use; never writes the answer or career library."""
    snapshot = InterviewFeedbackInput.model_validate(task.input)
    # Only the Rails snapshot builder supplies this marker after saving the revisions.
    if snapshot.saved_input_snapshot is not None:
        register_saved_sources([snapshot.answer_text, snapshot.question_text])
    settings = dependencies.settings
    usage = []

    def fail(message):
        """Preserves billed screening and generation usage on expected failures."""
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=message, usage=usage)

    def screen(text):
        """Screens user text and records classifier usage."""
        outcome = screen_user_text(text, model=settings.user_text_screen_model,
                                   timeout_seconds=settings.llm_run_timeout_seconds)
        usage.extend(outcome.model_usages)
        return outcome

    if not snapshot.answer_text.strip():
        return fail("Write an answer before asking for feedback.")
    outcome = screen(snapshot.answer_text)
    if not outcome.allowed:
        return fail("Your answer is saved. " + (
            "We couldn't check it right now. Try requesting feedback again." if outcome.unchecked else
            "We couldn't use it for AI feedback. Revise it and try again."))
    if not screen(snapshot.question_text).allowed:
        return fail("Your answer is saved. We couldn't check this question. Try requesting feedback again.")
    if dependencies.read_career_library is None:
        raise RuntimeError("Career library reader is not configured")
    library = dependencies.read_career_library(task.user_id).model_copy(deep=True)
    register_saved_sources(library_source_values(library, include_fact_requirements=False).sources)
    selected = screen_library_inputs(library, screen, include_fact_requirements=False)
    library = selected.library
    warnings = list(selected.warnings)
    content = library.model_dump(mode="json", exclude_none=True,
                               exclude={"facts": {"__all__": {"requirement"}}})
    text = bind_screened_prompt(
        [snapshot.answer_text, snapshot.question_text, *selected.sources],
        lambda values: _feedback_prompt_text(values, selected.fields, snapshot.set_type),
    )
    if text_limits.prompt_is_too_long(text):
        return fail("Your answer is saved. Shorten your career library entries before requesting feedback.")
    context = InterviewFeedbackContext(text, snapshot.answer_text + "\n" + _library_evidence_text(content), snapshot.set_type)
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
    content = library.model_dump(mode="json", exclude_none=True,
        exclude={"facts": {"__all__": {"requirement"}}})
    return json.dumps({"set_type": set_type, "question": values[1], "answer": values[0],
        "career_library": content}, ensure_ascii=False)
