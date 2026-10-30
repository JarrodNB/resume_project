"""Bound saved interview dialogue and the coaching returned for its answered questions.

The owned reader supplies canonical dialogue; reject unusable inputs before paid work.
Only accepted answers provide personal evidence, while role text describes a job.
"""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ShortCoaching = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class FeedbackInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feedback_id: UUID


class SavedDialogue(BaseModel):
    kind: Literal["answer", "follow_up"]
    content: str = Field(min_length=1, max_length=20000)


class SavedQuestion(BaseModel):
    question_id: UUID
    question: str = Field(min_length=1, max_length=4000)
    dialogue: list[SavedDialogue] = Field(min_length=1, max_length=7)

    @model_validator(mode="after")
    def has_answer(self):
        if not any(item.kind == "answer" and item.content.strip() for item in self.dialogue):
            raise ValueError("Feedback requires an accepted answer")
        return self


class FeedbackRole(BaseModel):
    title: str = Field(default="", max_length=4000)
    responsibilities: list[str] = Field(default_factory=list, max_length=80)
    requirements: list[str] = Field(default_factory=list, max_length=80)


class FeedbackClaim(BaseModel):
    questions: list[SavedQuestion] = Field(min_length=1, max_length=20)
    role: FeedbackRole = Field(default_factory=FeedbackRole)

    @model_validator(mode="after")
    def unique_questions(self):
        ids = [question.question_id for question in self.questions]
        if len(ids) != len(set(ids)):
            raise ValueError("Question identities must be unique")
        return self


class QuestionFeedback(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: UUID = Field(description="Copy the exact saved core question ID.")
    strengths: list[ShortCoaching] = Field(min_length=1, max_length=5)
    improvements: list[ShortCoaching] = Field(min_length=1, max_length=5)
    example_answer: str = Field(min_length=1, max_length=6000,
        description="Illustrative better answer; preserve supplied personal facts and mark missing ones.")


class InterviewSessionFeedback(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=1, max_length=4000)
    questions: list[QuestionFeedback] = Field(min_length=1, max_length=20)
