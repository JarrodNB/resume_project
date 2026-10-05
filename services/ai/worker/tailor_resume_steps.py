"""
Description: The pieces of one tailor_resume step that are not the model call: folding the
user's decision, screening gap responses, copying contact, and pausing or failing.
Index:
    - apply_pending: approve, omit, reopen, or reject a blocked edit
    - screened_gap_responses: gap responses that passed the screen
    - contact_content: profile contact with no model call
    - pause_for_section: a needs_user_input result for one section
    - failed_result: a failed result with a user-facing message
"""

from typing import Any

from gap_analysis.screen_library_facts import LIBRARY_FACT_OMITTED_WARNING
from screening.screen_user_text import screen_user_text
from tailoring.section_catalog import SECTION_TITLES, sections_before
from tailoring.tailor_resume_input import (
    ApprovedSection,
    TailorResumeInput,
    section_plain_text,
    section_snapshot,
)
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage, AiTaskMessage, ModelUsage
from worker.task_dependencies import TaskDependencies


def apply_pending(
    data: TailorResumeInput, dependencies: TaskDependencies, usage: list[ModelUsage]
) -> tuple[list[ApprovedSection], dict[str, Any] | None]:
    """Folds the user's decision into the approved list. A blocked edit returns the content
    to show again and does not call the writer."""
    approved = list(data.approved_sections)
    pending = data.pending_section
    if pending is None:
        return approved, None
    if pending.action == "reopen":
        keep = sections_before(pending.section_type)
        return [section for section in approved if section.section_type in keep], None
    if pending.action == "omit":
        approved.append(section_snapshot(pending.section_type, {}, omitted=True))
        return approved, None
    if pending.action == "write_anyway":
        return approved, None
    outcome = screen_user_text(
        section_plain_text(pending.content),
        model=dependencies.settings.user_text_screen_model,
        timeout_seconds=dependencies.settings.llm_run_timeout_seconds,
    )
    if outcome.usage is not None and outcome.model is not None:
        usage.append(build_model_usage(outcome.model, outcome.usage))
    if not outcome.allowed:
        return approved, pending.content
    approved.append(section_snapshot(pending.section_type, pending.content, omitted=False))
    return approved, None


def screened_gap_responses(
    responses: list[dict[str, str]],
    dependencies: TaskDependencies,
    usage: list[ModelUsage],
    warnings: list[str],
) -> list[dict[str, str]]:
    """Drops a gap response whose body fails the screen, and warns once."""
    kept: list[dict[str, str]] = []
    omitted = False
    settings = dependencies.settings
    for response in responses:
        outcome = screen_user_text(
            response.get("body", ""),
            model=settings.user_text_screen_model,
            timeout_seconds=settings.llm_run_timeout_seconds,
        )
        if outcome.usage is not None and outcome.model is not None:
            usage.append(build_model_usage(outcome.model, outcome.usage))
        if outcome.allowed:
            kept.append(response)
        else:
            omitted = True
    if omitted:
        warnings.append(LIBRARY_FACT_OMITTED_WARNING)
    return kept


def contact_content(contact: dict[str, Any]) -> dict[str, Any]:
    """Contact copied from the profile snapshot on the task. No model call."""
    return {
        "full_name": contact.get("full_name"),
        "email": contact.get("email"),
        "phone": contact.get("phone"),
        "location": contact.get("location"),
        "links": list(contact.get("links") or []),
    }


def pause_for_section(
    task: AiTaskMessage,
    data: TailorResumeInput,
    approved: list[ApprovedSection],
    content: dict[str, Any],
    usage: list[ModelUsage],
    warnings: list[str],
    *,
    section_type: str | None = None,
    nothing_fits: bool = False,
    blocked: bool = False,
    message: str | None = None,
) -> AiResultMessage:
    """Pauses on one section. A blocked edit keeps that section open. Approved sections ride
    along so Rails can store them on the task for a reload."""
    current = section_type or (data.pending_section.section_type if data.pending_section else "contact")
    question = {
        "section_type": current,
        "title": SECTION_TITLES[current],
        "content": content,
        "nothing_fits": nothing_fits,
        "blocked": blocked,
        "message": message,
        "warnings": warnings,
        "approved_sections": [section.model_dump(mode="json") for section in approved],
    }
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="needs_user_input",
        pending_questions=[question],
        generation=data.generation,
        usage=usage,
    )


def failed_result(task: AiTaskMessage, error_message: str) -> AiResultMessage:
    """A failed result with a message the user sees."""
    return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=error_message)
