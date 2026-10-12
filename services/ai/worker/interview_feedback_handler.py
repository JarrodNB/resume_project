"""
Description: Screens a saved answer and generates revision-bound interview feedback.
Index:
    - InterviewFeedbackInput: immutable Rails snapshot
    - handle_interview_feedback_task: read-only coaching and usage reporting
"""
import json
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_feedback_agent import generate_interview_feedback
from gap_analysis.screen_library_facts import select_screened_facts
from schemas.interview_feedback import InterviewFeedbackContext
from schemas.interview_questions import InterviewSetType
from screening.screen_user_text import screen_user_text
from worker.interview_questions_handler import _library_evidence_text
from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


class InterviewFeedbackInput(BaseModel):
    """Question and answer revisions saved before queue publication."""

    question_set_id: UUID
    set_type: InterviewSetType = "general"
    question_id: UUID
    question_text: str = Field(min_length=1)
    answer_text: str = Field(min_length=1, max_length=text_limits.MAX_INTERVIEW_ANSWER)
    question_revision: int = Field(ge=1)
    answer_revision: int = Field(ge=0)


def handle_interview_feedback_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """Screens before model use; never writes the answer or career library."""
    snapshot = InterviewFeedbackInput.model_validate(task.input)
    settings = dependencies.settings
    usage = []

    def fail(message):
        """Preserves billed screening and generation usage on expected failures."""
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=message, usage=usage)

    def screen(text):
        """Screens user text and records Jev usage."""
        outcome = screen_user_text(text, model=settings.user_text_screen_model,
                                   timeout_seconds=settings.llm_run_timeout_seconds)
        if outcome.usage is not None and outcome.model is not None:
            usage.append(build_model_usage(outcome.model, outcome.usage))
        return outcome

    if not snapshot.answer_text.strip():
        return fail("Write an answer before asking for feedback.")
    outcome = screen(snapshot.answer_text)
    if not outcome.allowed:
        return fail("Your answer is saved. " + (
            "We couldn't check it right now. Try requesting feedback again." if outcome.unchecked else
            "We couldn't use it for AI feedback. Revise it and try again."))
    if dependencies.read_career_library is None:
        raise RuntimeError("Career library reader is not configured")
    library = dependencies.read_career_library(task.user_id).model_copy(deep=True)
    library.facts = [fact.model_copy(update={"requirement": ""}) for fact in library.facts]
    library.facts, warnings = select_screened_facts(library.facts, screen)
    content = library.model_dump(mode="json", exclude_none=True,
                               exclude={"facts": {"__all__": {"requirement"}}})
    text = json.dumps({"set_type": snapshot.set_type, "question": snapshot.question_text, "answer": snapshot.answer_text,
                       "career_library": content}, ensure_ascii=False)
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
