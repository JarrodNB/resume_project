"""Bound complete role/question output; the agent also checks the saved session's length."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class FictionalInterviewRole(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    responsibilities: list[str] = Field(min_length=1, max_length=6)
    requirements: list[str] = Field(min_length=1, max_length=6)

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value):
        if not value.strip():
            raise ValueError("Role title must not be blank")
        return value

    @field_validator("responsibilities", "requirements")
    @classmethod
    def bounded_items(cls, values):
        if any(not value.strip() or len(value) > 200 for value in values):
            raise ValueError("Role items must contain 1 to 200 characters")
        return values


class PreparedInterviewQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_type: Literal["behavioral", "technical", "knowledge"]
    content: str = Field(min_length=1, max_length=400)


class InterviewPreparation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: FictionalInterviewRole
    questions: list[PreparedInterviewQuestion] = Field(min_length=5, max_length=12)

    @model_validator(mode="after")
    def distinct_interleaved_questions(self):
        count = len(self.questions)
        if count not in (5, 8, 9, 12):
            raise ValueError("Unsupported question count")
        if [question.question_type for question in self.questions] != [
            ["behavioral", "technical", "knowledge"][i % 3] for i in range(count)
        ]:
            raise ValueError("Interleave behavioral, technical and knowledge questions")
        text = [" ".join(question.content.casefold().split()) for question in self.questions]
        if any(not value for value in text) or len(set(text)) != count:
            raise ValueError("Provide distinct nonblank questions")
        return self
