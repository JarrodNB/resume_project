"""Bounded owner-supplied dialogue context and editable next-job preference proposals."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProposedJobPreference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=500)
    priority: Literal["must_have", "nice_to_have"]

    @field_validator("text")
    @classmethod
    def meaningful_text(cls, value):
        if not value.strip() or any(ord(char) < 32 for char in value):
            raise ValueError("Use one nonblank preference without control characters")
        return value.strip()


class JobPreferenceProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reply: str = Field(min_length=1, max_length=1000)
    criteria: list[ProposedJobPreference] = Field(max_length=10)

    @field_validator("reply")
    @classmethod
    def nonblank_reply(cls, value):
        if not value.strip():
            raise ValueError("Reply must not be blank")
        return value.strip()


class ConversationCriterion(ProposedJobPreference):
    id: str = Field(min_length=1)


class JobPreferenceConversationInput(BaseModel):
    profile_version: int = Field(ge=0)
    criteria: list[ConversationCriterion] = Field(default_factory=list, max_length=10)
    trusted_criteria: list[str] = Field(default_factory=list, max_length=10)
    message: str = Field(min_length=1, max_length=4000)
    history: list[dict] = Field(default_factory=list)
    previous_task_id: str | None = None
    question_id: str | None = None
    turn: int = Field(ge=1, le=12)

    @model_validator(mode="after")
    def owned_history(self):
        if self.history and not self.previous_task_id:
            raise ValueError("Saved dialogue requires an owned previous task")
        if self.question_id and not self.history:
            raise ValueError("A deferred answer requires saved history")
        return self
