"""
Description: Grounded interview question drafts and per-run validation context.
Index:
    - InterviewQuestionDraft / InterviewQuestions: persisted result output
    - InterviewQuestionBase / InterviewQuestionSelection / InterviewQuestionSelections: internal ID-based output
    - InterviewQuestionContext: prompt, evidence, expected count, excluded questions
    - InterviewSetType / QUESTION_CATEGORIES: valid scopes and their five category values
    - normalize_question: stable comparison for duplicate wording
"""
import json
import re
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

InterviewSetType = Literal["general", "technical", "knowledge"]
QUESTION_CATEGORIES = {
    "general": ("introduction", "strengths", "development", "goals", "behavioral"),
    "technical": ("work_overview", "tools_methods", "decisions_tradeoffs", "problem_solving", "improvement_quality"),
    "knowledge": ("concepts", "mechanisms", "application", "reasoning", "limitations"),
}


class InterviewQuestionBase(BaseModel):
    """Shared text and category fields for model selections and persisted questions."""

    question_text: str = Field(min_length=10, max_length=1000)
    category: Literal["introduction", "strengths", "development", "goals", "behavioral",
                      "work_overview", "tools_methods", "decisions_tradeoffs", "problem_solving", "improvement_quality",
                      "concepts", "mechanisms", "application", "reasoning", "limitations"]


class InterviewQuestionDraft(InterviewQuestionBase):
    """Persisted question with original library excerpts resolved by code."""

    evidence_quotes: list[str] = Field(min_length=1, description="Exact excerpts from library data supporting any stated facts. Do not treat these excerpts as proof of unstated assumptions.")


class InterviewQuestions(BaseModel):
    """Five new drafts or one replacement, as required by the run context."""

    questions: list[InterviewQuestionDraft] = Field(min_length=1, max_length=5)


class InterviewQuestionSelection(InterviewQuestionBase):
    """Model draft citing supplied evidence IDs instead of copying library text."""

    evidence_ids: list[str] = Field(min_length=1, description="IDs from the supplied evidence catalog supporting the question, e.g. E1. Never invent IDs.")


class InterviewQuestionSelections(BaseModel):
    """Internal model output, resolved to the unchanged persisted question format."""

    questions: list[InterviewQuestionSelection] = Field(min_length=1, max_length=5)


@dataclass(frozen=True)
class InterviewQuestionContext:
    """Trusted constraints separate from the untrusted library prompt."""

    text: str
    library_text: str
    count: int
    excluded: tuple[str, ...] = ()
    set_type: InterviewSetType = "general"
    evidence: dict[str, str] = field(init=False)

    def __post_init__(self) -> None:
        """Labels original nonblank library lines and supplies the same catalog to every run."""
        excerpts = dict.fromkeys(line for line in self.library_text.splitlines() if line.strip())
        evidence = {f"E{index}": line for index, line in enumerate(excerpts, start=1)}
        object.__setattr__(self, "evidence", evidence)
        object.__setattr__(self, "text", self.text + "\nEvidence catalog JSON data:\n" + json.dumps(evidence, ensure_ascii=False))


def normalize_question(text: str) -> str:
    """Ignores casing, punctuation, and spacing for duplicate checks."""
    return " ".join(re.findall(r"\w+", text.casefold()))
