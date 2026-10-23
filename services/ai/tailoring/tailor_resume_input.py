"""Validate snapshots supplied when a complete resume draft is requested."""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class TailorResumeInput(BaseModel):
    """Read-only job, profile, and gap snapshots for one complete generation."""

    target_page_count: int = Field(default=2, strict=True, ge=1, le=2)
    job_id: UUID
    contact: dict[str, Any] = Field(default_factory=dict)
    gap_analysis: dict[str, Any] | None = None
    gap_responses: list[dict[str, str]] = Field(default_factory=list)
