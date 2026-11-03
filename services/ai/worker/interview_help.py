"""Run one admitted interview-help attempt without repeating paid work on redelivery.

Clarification, career references and completed-interview coaching share the claim and
owned-context sequence. Their command checks, saved-context errors and feature work
stay distinct. Rails owns admission and acceptance; the worker still owns accounting
and result publication, including failures that need an explicit user-requested retry.
"""

from collections.abc import Callable
from dataclasses import dataclass

from pydantic import BaseModel

from database.interview_auxiliary import build_interview_auxiliary_reader
from schemas.interview_session_feedback import FeedbackInput
from worker.interview_clarification_handler import ClarificationInput, explain_claimed_question
from worker.interview_references_handler import ReferenceInput, retrieve_claimed_references
from worker.interview_session_feedback_handler import coach_claimed_interview
from worker.queue_messages import AiResultMessage, AiTaskMessage, TaskType
from worker.task_dependencies import TaskDependencies


@dataclass(frozen=True)
class _InterviewHelp:
    command: type[BaseModel]
    claim_path: str
    configuration_error: str
    context_error: str
    execute: Callable[[AiTaskMessage, TaskDependencies, dict], AiResultMessage]
    # Clarification historically inherits the injected client's redirect policy.
    follow_redirects: bool | None = False


_ATTEMPTS: dict[TaskType, _InterviewHelp] = {
    "interview_clarification": _InterviewHelp(
        ClarificationInput, "clarifications", "Question clarification is not configured",
        "Question changed", explain_claimed_question, follow_redirects=None,
    ),
    "interview_references": _InterviewHelp(
        ReferenceInput, "references", "Career references are not configured",
        "Question changed", retrieve_claimed_references,
    ),
    "interview_session_feedback": _InterviewHelp(
        FeedbackInput, "feedback", "Interview feedback is not configured",
        "Saved interview feedback context is invalid", coach_claimed_interview,
    ),
}


def requires_explicit_retry(task_type: TaskType) -> bool:
    """A failed claim or admitted attempt cannot authorize automatic paid execution."""
    return task_type in _ATTEMPTS


def _handle_interview_help(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    attempt = _ATTEMPTS[task.task_type]
    attempt.command.model_validate(task.input)
    settings = dependencies.settings
    if not settings.interview_service_secret.strip():
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed",
            error_message=attempt.configuration_error,
        )
    options = (
        {"follow_redirects": attempt.follow_redirects}
        if attempt.follow_redirects is not None else {}
    )
    response = dependencies.http_client.post(
        settings.interview_rails_origin.rstrip("/")
        + f"/internal/interviews/{attempt.claim_path}/{task.ai_task_id}/claim",
        headers={"Authorization": f"Bearer {settings.interview_service_secret}"},
        timeout=10,
        **options,
    )
    response.raise_for_status()
    grant = response.json()
    if not grant.get("allowed"):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="usage")
    reader = dependencies.read_interview_auxiliary or build_interview_auxiliary_reader(settings)
    try:
        saved = reader(task, grant)
    except (ValueError, KeyError):
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message=attempt.context_error,
        )
    return attempt.execute(task, dependencies, saved)


# Dispatch and retry policy derive from the same three admitted kinds.
INTERVIEW_HELP_HANDLERS = dict.fromkeys(_ATTEMPTS, _handle_interview_help)
