"""
Description: Public interview questions and model-facing drafts with temporary evidence IDs.
General practice has one introduction and four behavioral themes; IDs establish evidence relevance.
Index:
    - InterviewQuestionDraft / InterviewQuestions: stable returned question shape
    - InterviewQuestionModelDraft / InterviewQuestionModelOutput: temporary-ID agent output
    - InterviewQuestionContext: prompt, evidence, expected count, excluded questions
    - InterviewSetType / QUESTION_CATEGORIES: valid scopes and their five category values
    - normalize_question: stable comparison for duplicate wording
"""
import re
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

InterviewSetType = Literal["general", "technical", "knowledge"]
QUESTION_CATEGORIES = {
    "general": ("introduction", "collaboration", "problem_solving", "learning_adaptation", "initiative_judgment"),
    "technical": ("work_overview", "tools_methods", "decisions_tradeoffs", "problem_solving", "improvement_quality"),
    "knowledge": ("concepts", "mechanisms", "application", "reasoning", "limitations"),
}


class InterviewQuestionDraft(BaseModel):
    """A question returned to Rails with exact saved career evidence."""

    question_text: str = Field(min_length=10, max_length=1000)
    category: Literal["introduction", "collaboration", "learning_adaptation", "initiative_judgment",
                      "work_overview", "tools_methods", "decisions_tradeoffs", "problem_solving", "improvement_quality",
                      "concepts", "mechanisms", "application", "reasoning", "limitations"]
    evidence_quotes: list[str] = Field(min_length=1)


class InterviewQuestionModelDraft(BaseModel):
    """Model-facing question draft; temporary evidence IDs avoid quote transcription."""

    question_text: str = Field(min_length=10, max_length=1000)
    category: Literal["introduction", "collaboration", "learning_adaptation", "initiative_judgment",
                      "work_overview", "tools_methods", "decisions_tradeoffs", "problem_solving", "improvement_quality",
                      "concepts", "mechanisms", "application", "reasoning", "limitations"]
    evidence_ids: list[str] = Field(
        min_length=1,
        description="Temporary IDs for exact career evidence shown in the prompt; do not copy source text.",
    )


class InterviewQuestionModelOutput(BaseModel):
    """Structured question-generation output before evidence IDs are resolved."""

    questions: list[InterviewQuestionModelDraft] = Field(min_length=1, max_length=5)


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
    evidence_by_id: dict[str, str] = field(default_factory=dict)


def normalize_question(text: str) -> str:
    """Ignores casing, punctuation, and spacing for duplicate checks."""
    return " ".join(re.findall(r"\w+", text.casefold()))
