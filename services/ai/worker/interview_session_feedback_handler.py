"""Generate coaching from canonical dialogue after interview-help admission.

interview_help owns claims and saved-context loading. This module validates coaching
sources, reuses their screening and returns bounded feedback. Turn-based answers were
screened before Rails accepted them; live answers were saved without a screen, so the
candidate's words are checked here before the feedback model sees them.
"""


import text_limits
from agents.interview_session_feedback_agent import generate_interview_session_feedback
from llm.run_generative_agent import GenerativeOutputInvalid
from model_inputs.interview_session_feedback import saved_feedback_sources
from privacy.contact_mask import mask_outbound
from schemas.interview_session_feedback import FeedbackClaim
from screening.prompt_guardrail import screening_failure_message
from screening.screen_user_text import screen_user_text
from screening.session import (
    bind_screened_prompt,
    remaining_timeout,
    trust_generated_source,
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
    if text_limits.prompt_is_too_long(sources.render(sources.values)):
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="Saved interview is too long to review",
        )
    usage = []
    if claim.conversation_mode == "live":
        # Interviewer text is generated output saved in the owned session; never screen it.
        for value in sources.interviewer:
            trust_generated_source(value)
        for answer in dict.fromkeys(sources.answers):
            outcome = screen_user_text(mask_outbound(answer), settings.user_text_screen_model,
                                       remaining_timeout(settings.llm_run_timeout_seconds),
                                       check_phrases=False)
            usage.extend(outcome.model_usages)
            if not outcome.allowed:
                return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                                       error_message=screening_failure_message(outcome))
    else:
        # The authenticated claim and owned DB read establish accepted dialogue provenance.
        # Do not reclassify accepted turn-based answers as new text.
        for value in sources.values:
            trust_rails_screened_source(value)
    prompt = bind_screened_prompt(sources.values, sources.render)
    try:
        feedback = generate_interview_session_feedback(prompt, claim, settings)
    except GenerativeOutputInvalid:
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            usage=usage,
            error_message="The AI could not produce valid interview feedback. Try again.",
        )
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        usage=usage,
        result={"interview_session_feedback": feedback.model_dump(mode="json")},
    )
