"""
Description: Grounded interview question drafts and per-run validation context.
Index:
    - InterviewQuestionDraft / InterviewQuestions: structured agent output
    - InterviewQuestionContext: prompt, evidence, expected count, excluded questions
    - normalize_question: stable comparison for duplicate wording
"""
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field


class InterviewQuestionDraft(BaseModel):
    """A non-technical question with exact library excerpts supporting its framing."""

    question_text: str = Field(min_length=10, max_length=1000)
    category: Literal["introduction", "strengths", "development", "goals", "behavioral"]
    evidence_quotes: list[str] = Field(min_length=1, description="Exact excerpts from library data supporting any stated facts. Do not treat these excerpts as proof of unstated assumptions.")


class InterviewQuestions(BaseModel):
    """Five new drafts or one replacement, as required by the run context."""

    questions: list[InterviewQuestionDraft] = Field(min_length=1, max_length=5)


@dataclass(frozen=True)
class InterviewQuestionContext:
    """Trusted constraints separate from the untrusted library prompt."""

    text: str
    library_text: str
    count: int
    excluded: tuple[str, ...] = ()


def normalize_question(text: str) -> str:
    """Ignores casing, punctuation, and spacing for duplicate checks."""
    return " ".join(re.findall(r"\w+", text.casefold()))
