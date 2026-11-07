"""Generate coaching from canonical dialogue after interview-help admission.

interview_help owns claims and saved-context loading. This module validates coaching
sources, reuses their screening and returns bounded feedback.
"""


import text_limits
from agents.interview_session_feedback_agent import generate_interview_session_feedback
from llm.run_generative_agent import GenerativeOutputInvalid
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
        feedback = generate_interview_session_feedback(prompt, claim, settings)
    except GenerativeOutputInvalid:
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="The AI could not produce valid interview feedback. Try again.",
        )
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"interview_session_feedback": feedback.model_dump(mode="json")},
    )
