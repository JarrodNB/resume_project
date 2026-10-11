"""
Description: Structured interview coaching, example, and trusted source context.
Index:
    - InterviewFeedback: feedback returned to Rails
    - InterviewFeedbackContext: prompt and permitted evidence
"""
from dataclasses import dataclass

from pydantic import BaseModel, Field


class InterviewFeedback(BaseModel):
    """Coaching without scores or changes to the user's answer."""

    strengths: list[str] = Field(min_length=1, max_length=5)
    improvements: list[str] = Field(min_length=1, max_length=5)
    example_answer: str = Field(min_length=1, max_length=1000)
    evidence_quotes: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class InterviewFeedbackContext:
    """Untrusted prompt data and exact source text for evidence validation."""

    text: str
    source_text: str
