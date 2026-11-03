"""Generate coaching from canonical dialogue after interview-help admission.

interview_help owns claims and saved-context loading. This module validates coaching
sources, reuses their screening and returns bounded feedback with model usage.
"""

from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_session_feedback_agent import generate_interview_session_feedback
from llm.model_prices import build_model_usage, reported_model_name
from model_inputs.interview_session_feedback import saved_feedback_sources
from schemas.interview_session_feedback import FeedbackClaim
from screening.session import (
    bind_screened_prompt,
    trust_rails_screened_source,
    within_screening_session,
)
from worker.queue_messages import AiResultMessage


@within_screening_session
def coach_claimed_interview(task, dependencies, saved):
    """Perform feature work only after a claim and owned context read succeed."""
    settings = dependencies.settings
    try:
        claim = FeedbackClaim.model_validate(saved)
    except (ValueError, KeyError):
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="Saved interview feedback context is invalid",
        )
    sources = saved_feedback_sources(claim)
    # The authenticated claim and owned DB read establish accepted dialogue provenance.
    # Do not reclassify accepted answers as new text.
    for source in sources:
        trust_rails_screened_source(source)
    prompt = bind_screened_prompt(
        sources, lambda values: "Review this completed interview:\n\n" + "\n\n".join(values)
    )
    if text_limits.prompt_is_too_long(prompt):
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="Saved interview is too long to review",
        )
    try:
        with capture_run_messages() as messages:
            run = generate_interview_session_feedback(prompt, claim, settings)
    except UnexpectedModelBehavior:
        usages = {}
        for message in messages:
            if isinstance(message, ModelResponse):
                model = reported_model_name(
                    message.model_name or settings.interview_feedback_model,
                    settings.interview_feedback_model,
                )
                usages.setdefault(model, RunUsage()).incr(message.usage)
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="The AI could not produce valid interview feedback. Try again.",
            usage=[build_model_usage(model, usage) for model, usage in usages.items()],
        )
    model = reported_model_name(
        run.response.model_name or settings.interview_feedback_model,
        settings.interview_feedback_model,
    )
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"interview_session_feedback": run.output.model_dump(mode="json")},
        usage=[build_model_usage(model, run.usage)],
    )
