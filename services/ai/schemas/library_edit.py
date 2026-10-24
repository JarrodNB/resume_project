"""One replacement field and its lightweight assessment; questions use deferred tools."""

from typing import Literal

from pydantic import BaseModel, Field

from schemas.gap_analysis_context import CareerLibrary
from schemas.library_review import LibraryReviewTarget


class LibraryEditInput(BaseModel):
    """Rails supplies owned snapshots/history; the browser supplies only the newest feedback."""

    section: Literal["experience"]
    library: CareerLibrary
    target: LibraryReviewTarget
    original_text: str = Field(max_length=4000)
    feedback: str = Field(default="", max_length=4000)
    history: list[dict] = Field(default_factory=list)
    previous_task_id: str | None = None
    question_id: str | None = None
    skip: bool = False
    turn: int = Field(ge=1, le=8)


class LibraryEditDraft(BaseModel):
    """Rewrite only the selected field, preserving what is known and what remains unknown."""

    text: str = Field(min_length=1, max_length=4000, description="Proposed replacement text only. Never invent personal facts or metrics.")
    color: Literal["red", "yellow", "green"] = Field(description="Assess the proposed text; do not automatically assign green.")
    reason: str = Field(min_length=1, max_length=240, description="One short explanation of the proposed text's assessment.")
