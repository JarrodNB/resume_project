"""Small traffic-light assessments and the exact saved targets a section review covers."""

from typing import Literal

from pydantic import BaseModel, Field

from schemas.gap_analysis_context import CareerLibrary


class LibraryReviewTarget(BaseModel):
    """Identity stays outside the prompt; a short label stands in for each saved field."""

    label: str
    kind: Literal["experience", "experience_highlight"]
    record_id: str
    field: Literal["description", "content"]
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")


class LibraryReviewInput(BaseModel):
    """An immutable, Rails-owned snapshot of only the requested library section."""

    section: Literal["experience"]
    library: CareerLibrary
    targets: list[LibraryReviewTarget] = Field(min_length=1, max_length=250)


class LibraryAssessmentDraft(BaseModel):
    """One useful nudge, not a numerical rating of someone's career."""

    target_label: str = Field(description="Copy the supplied target label, such as T1.")
    color: Literal["red", "yellow", "green"]
    reason: str = Field(min_length=1, max_length=240, description="One short, specific reason for this color; no invented facts.")


class LibraryReviewDraft(BaseModel):
    """The model must assess every supplied target exactly once."""

    assessments: list[LibraryAssessmentDraft] = Field(min_length=1, max_length=250)
