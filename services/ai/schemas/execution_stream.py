"""Public, bounded output events; execution inputs and model tools never belong here."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


class StreamIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    feature: str = Field(pattern=r"^[a-z][a-z_]{0,30}$")
    operation_id: UUID
    attempt_id: UUID
    claim_generation: StrictInt = Field(gt=0)


class StreamEvent(StreamIdentity):
    version: Literal[1] = 1
    type: Literal["started", "delta", "completed", "failed", "cancelled", "superseded"]
    text: str | None = Field(default=None, min_length=1, max_length=4096)

    @model_validator(mode="after")
    def public_text_only(self):
        if (self.type == "delta") != (self.text is not None):
            raise ValueError("Only text deltas carry text")
        return self
