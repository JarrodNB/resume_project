"""Five answered learning questions returned to Rails; source snapshots stay task metadata."""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
QuestionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
AnswerText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6000)]


class StudyGuideInput(BaseModel):
    """The exact owned job description captured by Rails at request acceptance."""
    model_config = ConfigDict(extra="forbid")
    job_id: UUID
    description: Annotated[str, StringConstraints(min_length=1, max_length=20_000)]
    previous_questions: list[QuestionText] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def bounded_previous_questions(self):
        if sum(map(len, self.previous_questions)) > 40_000:
            raise ValueError("Previous study questions exceed the generation context limit")
        return self


class StudyQuestion(BaseModel):
    """A self-contained question and teaching answer, not a candidate's experience."""
    question: QuestionText = Field(description="One specific learning question, phrased as a question.")
    why_it_matters: QuestionText = Field(description="Its relevance to duties stated in the description.")
    answer: AnswerText = Field(description="Explain the answer, how it works, and why; teach rather than give a terse definition.")
    example: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3000)] = Field(description="A concrete hypothetical worked example, including its reasoning or outcome.")


class StudyGuide(BaseModel):
    """One batch of exactly five prioritized, answered questions."""
    version: Literal[1] = 1
    title: ShortText
    questions: list[StudyQuestion] = Field(min_length=5, max_length=5, description="Five distinct questions, highest priority first.")


class StudyGuideUnavailable(BaseModel):
    """Explain an unusable source without inventing an occupation or lessons."""
    cannot_generate_reason: QuestionText = Field(description="Ask for a meaningful job description when the source cannot support relevant questions.")
