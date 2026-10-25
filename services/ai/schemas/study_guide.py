"""Bounded learning material returned to Rails; source snapshots remain task metadata."""
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Bullet = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class StudyGuideInput(BaseModel):
    """The exact owned job description captured by Rails at request acceptance."""
    model_config = ConfigDict(extra="forbid")
    job_id: UUID
    description: Annotated[str, StringConstraints(min_length=1, max_length=20_000)]


class StudyTopic(BaseModel):
    """One topic, ordered by importance to the described work."""
    title: ShortText
    why_it_matters: Bullet = Field(description="Explain its relevance to the job description.")
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    exercises: list[Bullet] = Field(min_length=1, max_length=5, description="Practical, independently usable learning tasks.")
    self_check_questions: list[Bullet] = Field(min_length=1, max_length=5, description="Questions to check understanding without grading.")


class StudyGuide(BaseModel):
    """A concise guide whose topic order communicates study priority."""
    title: ShortText
    topics: list[StudyTopic] = Field(min_length=1, max_length=8, description="Highest priority first; use fewer for sparse descriptions.")
