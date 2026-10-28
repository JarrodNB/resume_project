"""Traffic-light assessments and optional questions for the exact saved review targets."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from schemas.gap_analysis_context import CareerLibrary


class LibraryReviewTarget(BaseModel):
    """Identity stays outside the prompt; a short label stands in for each saved field."""

    label: str
    kind: Literal["experience", "experience_highlight", "user", "project", "career_context"]
    record_id: str
    field: Literal["description", "content", "summary", "response"]
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")


class LibraryReviewInput(BaseModel):
    """An immutable, Rails-owned snapshot of only the requested library section."""

    section: Literal["experience", "summary", "projects", "career_contexts"]
    library: CareerLibrary
    targets: list[LibraryReviewTarget] = Field(min_length=1, max_length=250)


    @model_validator(mode="after")
    def only_selected_section(self):
        validate_section_library(self.section, self.library)
        return self


def validate_section_library(section: str, library: CareerLibrary) -> None:
    """Reject unrelated section material before screening or rendering a prompt."""
    allowed = {"experience": "experiences", "summary": "summary", "projects": "projects", "career_contexts": "career_contexts"}[section]
    fields = ("summary", "experiences", "projects", "career_contexts", "educations", "certifications", "skills")
    if any(getattr(library, field) for field in fields if field != allowed):
        raise ValueError("A library task must contain only its selected section")


class LibraryAssessmentDraft(BaseModel):
    """A short reason and up to three distinct questions about useful missing evidence."""

    target_label: str = Field(description="Copy the supplied target label, such as T1.")
    color: Literal["red", "yellow", "green"]
    reason: str = Field(min_length=1, max_length=240, description="One short, specific reason for this color; no invented facts.")
    questions: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(
        default_factory=list, max_length=3,
        description="Zero to three focused, distinct questions about useful missing facts, most important first. Use an empty list when no fact is missing; never pad to three, require metrics, or invent premises.",
    )

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_question(cls, values):
        if isinstance(values, dict) and "question" in values:
            values = values.copy()
            legacy = values.pop("question")
            if legacy is not None and (not isinstance(legacy, str) or not legacy.strip() or len(legacy) > 500):
                raise ValueError("The legacy question must be a bounded nonblank string")
            if "questions" not in values:
                values["questions"] = [] if legacy is None else [legacy]
            else:
                first = values["questions"][0] if isinstance(values["questions"], list) and values["questions"] else None
                if (legacy.strip() if isinstance(legacy, str) else legacy) != (first.strip() if isinstance(first, str) else first):
                    raise ValueError("The legacy question must match the first question")
        return values

    @field_validator("questions")
    @classmethod
    def distinct_nonblank_questions(cls, values):
        normalized = [value.strip() for value in values]
        keys = [" ".join(value.split()).casefold() for value in normalized]
        if any(not key for key in keys) or len(keys) != len(set(keys)):
            raise ValueError("Questions must be nonblank and distinct")
        return normalized

    @property
    def question(self) -> str | None:
        """Keep the first question available to legacy scalar consumers."""
        return self.questions[0] if self.questions else None


class LibraryReviewDraft(BaseModel):
    """The model must assess every supplied target exactly once."""

    assessments: list[LibraryAssessmentDraft] = Field(min_length=1, max_length=250)
