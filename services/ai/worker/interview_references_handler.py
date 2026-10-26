"""Claim candidate-facing references before running any paid search work.

Rails owns prompt availability and once-only claims. Search results go only to the
candidate UI, never an interviewer model or answer draft.
"""
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from database.career_library_reader import build_database_library_reader
from interviews.references import retrieve_references
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage


class ReferenceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference_id: UUID
    question_text: str = Field(min_length=1, max_length=4000)


def handle_interview_references_task(task, dependencies):
    """Duplicate deliveries exit before embeddings and retain zero-cost accounting."""
    snapshot = ReferenceInput.model_validate(task.input)
    settings = dependencies.settings
    if not settings.interview_service_secret.strip():
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="Career references are not configured")
    response = dependencies.http_client.post(
        settings.interview_rails_origin.rstrip("/") + f"/internal/interviews/references/{task.ai_task_id}/claim",
        headers={"Authorization": f"Bearer {settings.interview_service_secret}"}, timeout=10,
        follow_redirects=False)
    response.raise_for_status()
    grant = response.json()
    if not grant.get("allowed"):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="usage")
    if grant.get("question_text") != snapshot.question_text:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message="Question changed")
    reader = dependencies.read_career_library or build_database_library_reader(settings)
    references, usage = retrieve_references(task.user_id, snapshot.question_text, settings, reader(task.user_id))
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"references": [reference.model_dump(mode="json") for reference in references]},
        usage=[build_model_usage(settings.embedding_model, usage)] if usage is not None else [])
