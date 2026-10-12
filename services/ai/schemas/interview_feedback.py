"""
Description: Structured interview coaching, example, and trusted source context.
Index:
    - InterviewFeedback: feedback returned to Rails
    - InterviewFeedbackContext: prompt and permitted evidence
"""
from dataclasses import dataclass

from pydantic import BaseModel, Field

from schemas.interview_questions import InterviewSetType


class InterviewFeedback(BaseModel):
    """Coaching without scores or changes to the user's answer."""

    strengths: list[str] = Field(min_length=1, max_length=5,
                               description="Observations supported by the actual answer, not library facts omitted from it.")
    improvements: list[str] = Field(min_length=1, max_length=5)
    example_answer: str = Field(min_length=1, max_length=1000, description=(
        "A clearer first-person version of ONLY personal facts explicitly stated in the answer or library. "
        "Do not invent or infer methods, actions, intentions, reasons, events or outcomes. "
        "Writing a test does NOT establish that it passed or confirmed a result. A skill does NOT supply "
        "its usual techniques or hands-on experience. Put ENTIRE missing details in at most TWO "
        "square-bracket placeholders, including unsupported verbs. Sparse facts need a short scaffold."
    ))
    evidence_quotes: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class InterviewFeedbackContext:
    """Untrusted prompt data and exact source text for evidence validation."""

    text: str
    source_text: str
    set_type: InterviewSetType = "general"
