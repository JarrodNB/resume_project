"""Describe one spoken follow-up or a request to let Rails advance the interview."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SpokenInterviewReply(BaseModel):
    decision: Literal["continue", "advance"] = Field(description="Continue with a follow-up, or request Rails advancement.")
    reply: str | None = Field(default=None, max_length=4000, description="A short relevant follow-up for continue; null for advance.")

    @model_validator(mode="after")
    def valid_reply(self):
        if self.decision == "continue" and (not self.reply or not self.reply.strip()):
            raise ValueError("Continuing requires a nonblank follow-up")
        if self.decision == "advance" and self.reply is not None:
            raise ValueError("Rails chooses the next question; advance has no reply")
        return self
