"""Retrieve candidate-facing references for an admitted interview-help attempt.

interview_help claims and loads the canonical prompt before calling this module.
Search results go only to the candidate UI, never an interviewer model or answer draft.
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from database.career_library_reader import build_database_library_reader
from interviews.references import SELECTION_POLICY_VERSION, retrieve_references
from llm.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage


class ReferenceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference_id: UUID
    message_id: UUID | None = None
    question_digest: str | None = None
    query_digest: str | None = None
    question_text: str | None = Field(default=None, max_length=4000)
    query_text: str | None = Field(default=None, min_length=1, max_length=12004)


def retrieve_claimed_references(task, dependencies, saved):
    """Perform feature work only after a claim and owned context read succeed."""
    settings = dependencies.settings
    reader = dependencies.read_career_library or build_database_library_reader(settings)
    references, usage = retrieve_references(
        task.user_id, saved["query_text"], settings, reader(task.user_id)
    )
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={
            "references": [reference.model_dump(mode="json") for reference in references],
            "selection_policy_version": SELECTION_POLICY_VERSION,
        },
        usage=[build_model_usage(settings.embedding_model, usage)] if usage is not None else [],
    )
