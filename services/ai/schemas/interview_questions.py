"""
Description: Interview question drafts and per-run validation context. General practice has
one introduction and four behavioral themes; excerpts ground background, not invited events.
Index:
    - InterviewQuestionDraft / InterviewQuestions: structured agent output
    - InterviewQuestionContext: prompt, evidence, expected count, excluded questions
    - InterviewSetType / QUESTION_CATEGORIES: valid scopes and their five category values
    - normalize_question: stable comparison for duplicate wording
"""
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

InterviewSetType = Literal["general", "technical", "knowledge"]
QUESTION_CATEGORIES = {
    "general": ("introduction", "collaboration", "problem_solving", "learning_adaptation", "initiative_judgment"),
    "technical": ("work_overview", "tools_methods", "decisions_tradeoffs", "problem_solving", "improvement_quality"),
    "knowledge": ("concepts", "mechanisms", "application", "reasoning", "limitations"),
}


class InterviewQuestionDraft(BaseModel):
    """A scoped question with exact library excerpts establishing topic relevance."""

    question_text: str = Field(min_length=10, max_length=1000)
    category: Literal["introduction", "collaboration", "learning_adaptation", "initiative_judgment",
                      "work_overview", "tools_methods", "decisions_tradeoffs", "problem_solving", "improvement_quality",
                      "concepts", "mechanisms", "application", "reasoning", "limitations"]
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
    set_type: InterviewSetType = "general"


def normalize_question(text: str) -> str:
    """Ignores casing, punctuation, and spacing for duplicate checks."""
    return " ".join(re.findall(r"\w+", text.casefold()))
