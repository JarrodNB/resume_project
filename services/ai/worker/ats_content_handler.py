"""Assess one owned snapshot; return identity so Rails can reject stale results."""

import asyncio
import json
from uuid import UUID

from pydantic import BaseModel
from pydantic_ai_harness import InputBlocked

import text_limits
from agents.ats_content_agent import assess_content
from pii import PiiDetectionError, PiiRestorationError
from schemas.ats_contact import contact_usability
from schemas.ats_content import validate_assessment
from schemas.ats_evidence import build_evidence_catalog
from screening.prompt_guardrail import BLOCKED_MESSAGE, TOO_LONG_MESSAGE, UNCHECKED_MESSAGE
from screening.screen_user_text import screen_user_text
from screening.session import bind_screened_prompt, within_screening_session
from worker.ats_content_privacy import prepare_ats_snapshot
from worker.contact_mask import import_privacy_scope
from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import AiResultMessage


class ContentInput(BaseModel):
    run_id: UUID
    resume_id: UUID
    content_fingerprint: str
    job_fingerprint: str | None
    rubric_version: str


@within_screening_session
def handle_ats_content_task(task, dependencies):
    """Fail closed on missing or mismatched snapshots before any provider request."""
    with import_privacy_scope() as privacy:
        try:
            return _assess_task(task, dependencies, privacy)
        except (PiiDetectionError, PiiRestorationError):
            return AiResultMessage(
                ai_task_id=task.ai_task_id,
                status="failed",
                error_message="We could not protect this resume's contact details. Please retry.",
            )


def _assess_task(task, dependencies, privacy):
    request = ContentInput.model_validate(task.input)
    snapshot = dependencies.read_ats_snapshot(task.user_id, request.run_id)
    identity = request.model_dump(mode="json", exclude={"resume_id"})
    if snapshot is None or any(
        str(getattr(snapshot, key)) != str(getattr(request, key))
        for key in ("resume_id", "content_fingerprint", "job_fingerprint", "rubric_version")
    ):
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="This resume check snapshot is unavailable.",
        )
    masked_snapshot = prepare_ats_snapshot(snapshot, privacy)
    catalog = build_evidence_catalog(masked_snapshot.content_snapshot)
    protected_input = masked_snapshot.model_dump(mode="json", exclude={"pdf_result"})
    protected_input["evidence_catalog"] = [item.model_dump(mode="json") for item in catalog]
    source = json.dumps(protected_input, ensure_ascii=False, separators=(",", ":"))
    if text_limits.prompt_is_too_long(source):
        raise InputBlocked(TOO_LONG_MESSAGE)
    settings = dependencies.settings
    decision = screen_user_text(
        source,
        model=settings.user_text_screen_model,
        timeout_seconds=settings.llm_run_timeout_seconds,
    )
    if not decision.allowed:
        raise InputBlocked(
            TOO_LONG_MESSAGE
            if decision.too_long
            else UNCHECKED_MESSAGE
            if decision.unchecked
            else BLOCKED_MESSAGE
        )
    prompt = bind_screened_prompt((source,), lambda values: values[0])
    run = asyncio.run(assess_content(prompt, masked_snapshot, settings, evidence_catalog=catalog))
    usage = [
        build_model_usage(
            reported_model_name(
                run.response.model_name or settings.gap_analysis_model, settings.gap_analysis_model
            ),
            run.usage,
        )
    ]
    if decision.usage is not None and decision.model is not None:
        usage.append(build_model_usage(decision.model, decision.usage))
    restored = privacy.restore(run.output)
    restored.checks = [
        contact_usability(snapshot.content_snapshot) if check.key == "contact_usability" else check
        for check in restored.checks
    ]
    validate_assessment(
        restored, snapshot.content_snapshot, (snapshot.job_snapshot or {}).get("requirements", [])
    )
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={**identity, **restored.model_dump(mode="json")},
        usage=usage,
    )
