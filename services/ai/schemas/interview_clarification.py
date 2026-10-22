"""Bound a short explanation of a prompt, never a candidate answer."""
from pydantic import BaseModel, Field, field_validator


class InterviewClarification(BaseModel):
    explanation: str = Field(min_length=1, max_length=1000)

    @field_validator("explanation")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Explanation must not be blank")
        return value
