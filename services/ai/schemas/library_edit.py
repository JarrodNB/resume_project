"""Owned single-field editing context, including optional review-answer batches and legacy turns."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from schemas.gap_analysis_context import CareerLibrary
from schemas.library_review import LibraryReviewTarget, validate_section_library


class LibraryReviewAnswer(BaseModel):
    """An answered saved question; omitted questions never become factual unknowns."""

    question_index: int = Field(strict=True, ge=0, le=2)
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=4000)

    @field_validator("question", "answer")
    @classmethod
    def nonblank_text(cls, value):
        if not value.strip():
            raise ValueError("Saved questions and answered fields must be nonblank")
        return value.strip()


class LibraryReviewQuestion(BaseModel):
    """Exact generated question resolved from the owned saved review, never browser text."""

    review_task_id: str = Field(min_length=1)
    question: str | None = Field(default=None, min_length=1, max_length=500)
    answers: list[LibraryReviewAnswer] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def legacy_or_batch(self):
        if bool(self.question) == bool(self.answers):
            raise ValueError("Supply one legacy question or a nonempty paired answer batch")
        if self.question is not None and not self.question.strip():
            raise ValueError("The saved question must be nonblank")
        indices = [item.question_index for item in self.answers]
        if len(indices) != len(set(indices)):
            raise ValueError("A batch cannot repeat a saved question index")
        return self


def generated_edit_messages(messages):
    """Keep provider output and application retry/ack state, never source/user requests.

    Legacy full conversations pass through the same projection during owned DB hydration.
    Deferred ask_user returns are reconstructed from command feedback instead of copied.
    """
    selected = []
    for message in messages:
        if message.get("kind") == "response":
            selected.append(message)
        elif message.get("kind") == "request":
            parts = [part for part in message.get("parts", [])
                     if part.get("part_kind") == "retry-prompt"
                     or part.get("part_kind") == "tool-return" and part.get("tool_name") != "ask_user"]
            if parts:
                selected.append({"kind": "request", "parts": parts})
    return selected


class LibraryEditTurn(BaseModel):
    """One successful owned ancestor: command feedback plus only that turn's generated state."""

    feedback: str = Field(default="", max_length=4000)
    skip: bool = False
    question_id: str | None = None
    history: list[dict] = Field(default_factory=list)


class LibraryEditInput(BaseModel):
    """Execution-local owned sources, canonical commands and per-turn generated fragments."""

    section: Literal["experience", "summary", "projects", "career_contexts"]
    library: CareerLibrary
    target: LibraryReviewTarget
    feedback: str = Field(default="", max_length=4000)
    turns: list[LibraryEditTurn] = Field(default_factory=list, max_length=7)
    previous_task_id: str | None = None
    question_id: str | None = None
    review_question: LibraryReviewQuestion | None = None
    skip: bool = False
    turn: int = Field(ge=1, le=8)


    @model_validator(mode="after")
    def only_selected_record(self):
        validate_section_library(self.section, self.library)
        if self.section != "summary":
            field = {"experience": "experiences", "projects": "projects", "career_contexts": "career_contexts"}[self.section]
            if len(getattr(self.library, field)) != 1:
                raise ValueError("An individual edit needs only its selected record context")
        return self


class LibraryEditDraft(BaseModel):
    """Rewrite the selected field using supplied facts and material qualifications."""

    text: str = Field(min_length=1, max_length=4000, description="Proposed career text using supplied facts and material qualifications. Never invent facts or metrics, or append disclaimers about information the user has not supplied.")
    color: Literal["red", "yellow", "green"] = Field(description="Assess the proposed text; do not automatically assign green.")
    reason: str = Field(min_length=1, max_length=240, description="One short explanation of the proposed text's assessment.")
