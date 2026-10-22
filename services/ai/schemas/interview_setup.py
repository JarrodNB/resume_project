"""Validate frozen interview choices supplied by Rails, including legacy nine-question plans."""
from typing import Literal

from pydantic import BaseModel, ConfigDict


class InterviewSetup(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    question_count: Literal[5, 8, 9, 12]
