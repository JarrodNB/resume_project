"""One replacement field and its lightweight assessment; questions use deferred tools."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from schemas.gap_analysis_context import CareerLibrary
from schemas.library_review import LibraryReviewTarget, validate_section_library


class LibraryReviewQuestion(BaseModel):
    """Exact generated question and review identity resolved by Rails, never browser text."""

    review_task_id: str = Field(min_length=1)
    question: str = Field(min_length=1, max_length=500)


class LibraryEditInput(BaseModel):
    """Rails supplies owned snapshots/history; the browser supplies only the newest feedback."""

    section: Literal["experience", "summary", "projects", "facts"]
    library: CareerLibrary
    target: LibraryReviewTarget
    original_text: str = Field(max_length=4000)
    feedback: str = Field(default="", max_length=4000)
    history: list[dict] = Field(default_factory=list)
    previous_task_id: str | None = None
    question_id: str | None = None
    review_question: LibraryReviewQuestion | None = None
    skip: bool = False
    turn: int = Field(ge=1, le=8)


    @model_validator(mode="after")
    def only_selected_record(self):
        validate_section_library(self.section, self.library)
        if self.section != "summary":
            field = {"experience": "experiences", "projects": "projects", "facts": "facts"}[self.section]
            if len(getattr(self.library, field)) != 1:
                raise ValueError("An individual edit needs only its selected record context")
        return self


class LibraryEditDraft(BaseModel):
    """Rewrite only the selected field, preserving what is known and what remains unknown."""

    text: str = Field(min_length=1, max_length=4000, description="Proposed replacement text only. Never invent personal facts or metrics.")
    color: Literal["red", "yellow", "green"] = Field(description="Assess the proposed text; do not automatically assign green.")
    reason: str = Field(min_length=1, max_length=240, description="One short explanation of the proposed text's assessment.")
