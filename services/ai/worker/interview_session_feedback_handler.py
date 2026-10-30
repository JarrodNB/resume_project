"""Claim completed-session feedback once and return coaching through the results queue.

The reader loads accepted answers and generated questions from their canonical rows.
Rails owns retention, once-only admission, eligibility and result acceptance.
"""

from pydantic import ValidationError
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

import text_limits
from agents.interview_session_feedback_agent import generate_interview_session_feedback
from database.interview_auxiliary import build_interview_auxiliary_reader
from llm.model_prices import build_model_usage, reported_model_name
from model_inputs.interview_session_feedback import saved_feedback_sources
from schemas.interview_session_feedback import FeedbackClaim, FeedbackInput
from screening.session import (
    bind_screened_prompt,
    trust_rails_screened_source,
    within_screening_session,
)
from worker.queue_messages import AiResultMessage


@within_screening_session
def handle_interview_session_feedback_task(task, dependencies):
    """An unsuccessful claim exits before generation, including duplicate delivery."""
    FeedbackInput.model_validate(task.input)
    settings = dependencies.settings
    if not settings.interview_service_secret.strip():
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="Interview feedback is not configured",
        )
    response = dependencies.http_client.post(
        settings.interview_rails_origin.rstrip("/")
        + f"/internal/interviews/feedback/{task.ai_task_id}/claim",
        headers={"Authorization": f"Bearer {settings.interview_service_secret}"},
        timeout=10,
        follow_redirects=False,
    )
    response.raise_for_status()
    grant = response.json()
    if not grant.get("allowed"):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="usage")
    try:
        reader = dependencies.read_interview_auxiliary or build_interview_auxiliary_reader(settings)
        claim = FeedbackClaim.model_validate(reader(task, grant))
    except (ValidationError, ValueError, KeyError):
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
