"""
Description: The pieces of one tailor_resume step that are not the model call: folding the
user's decision, screening sources, copying contact, and pausing or failing.
Index:
    - apply_pending: approve, omit, reopen, or reject a blocked edit
    - screen_tailoring_text: source decisions and newly billed usage
    - contact_content: profile contact with no model call
    - pause_for_section: a needs_user_input result for one section
    - failed_result: a failed result with a user-facing message
"""

from typing import Any

import text_limits
from screening.screen_user_text import ScreenOutcome, screen_user_text
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
) -> tuple[list[ApprovedSection], dict[str, Any] | None, str | None]:
    """Folds the user's decision into the approved list. A blocked edit returns the content
    to show again, plus a length message when the text was too long, and does not call the writer."""
    approved = list(data.approved_sections)
    pending = data.pending_section
    if pending is None:
        return approved, None, None
    if pending.action == "reopen":
        keep = sections_before(pending.section_type)
        return [section for section in approved if section.section_type in keep], None, None
    if pending.action == "omit":
        approved.append(section_snapshot(pending.section_type, {}, omitted=True))
        return approved, None, None
    if pending.action == "write_anyway":
        return approved, None, None
    outcome = screen_tailoring_text(
        f"{SECTION_TITLES[pending.section_type]}: {section_plain_text(pending.content)}",
        dependencies, usage,
    )
    if not outcome.allowed:
        message = text_limits.SECTION_TOO_LONG_MESSAGE if outcome.too_long else None
        return approved, pending.content, message
    approved.append(section_snapshot(pending.section_type, pending.content, omitted=False))
    return approved, None, None


def screen_tailoring_text(
    text: str, dependencies: TaskDependencies, usage: list[ModelUsage],
) -> ScreenOutcome:
    """Screen a source and report only newly billed calls in this execution."""
    outcome = screen_user_text(
        text, model=dependencies.settings.user_text_screen_model,
        timeout_seconds=dependencies.settings.llm_run_timeout_seconds,
    )
    if outcome.usage is not None and outcome.model is not None:
        usage.append(build_model_usage(outcome.model, outcome.usage))
    return outcome


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


def failed_result(
    task: AiTaskMessage,
    error_message: str,
    usage: list[ModelUsage] | None = None,
    generation: int | None = None,
) -> AiResultMessage:
    """A failed result with a message the user sees. Usage and generation are set when a
    tailor step already spent tokens before it stopped."""
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="failed",
        error_message=error_message,
        usage=usage or [],
        generation=generation,
    )
