"""Validate only the identities and settings for a complete resume draft.

Retained commands may contain obsolete source copies; they are ignored. Execution
always reads current owned records and never trusts those copied fields.
"""

from uuid import UUID

from pydantic import BaseModel


class TailorResumeInput(BaseModel):
    """A saved job, optional completed comparison, and presentation preference."""

    job_id: UUID
    analysis_task_id: UUID | None = None
    include_summary: bool = True
