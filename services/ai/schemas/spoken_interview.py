"""Describe a brief acknowledgement plus a follow-up or Rails-owned advancement.

The acknowledgement refers only to the candidate answer; it never contains the next question.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SpokenInterviewReply(BaseModel):
    acknowledgement: str = Field(min_length=1, max_length=280,
        description="One short factual sentence acknowledging a specific detail in the newest answer; no praise, evaluation, coaching or question.")
    decision: Literal["continue", "advance"] = Field(description="Continue with a follow-up, or request Rails advancement.")
    reply: str | None = Field(default=None, max_length=4000, description="A short relevant follow-up for continue; null for advance.")

    @model_validator(mode="after")
    def valid_reply(self):
        if not self.acknowledgement.strip():
            raise ValueError("Acknowledgement must not be blank")
        if self.decision == "continue" and (not self.reply or not self.reply.strip()):
            raise ValueError("Continuing requires a nonblank follow-up")
        if self.reply and len(self.acknowledgement) + 2 + len(self.reply) > 4000:
            raise ValueError("Acknowledgement and follow-up exceed the speech text limit")
        if self.decision == "advance" and self.reply is not None:
            raise ValueError("Rails chooses the next question; advance has no reply")
        return self
