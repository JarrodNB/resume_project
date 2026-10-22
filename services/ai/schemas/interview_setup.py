"""Validate frozen interview choices supplied by Rails, including legacy nine-question plans."""
from typing import Literal

from pydantic import BaseModel, ConfigDict


class InterviewSetup(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    question_count: Literal[5, 8, 9, 12]
    question_format: Literal["mixed", "behavioral", "technical", "screening"] = "mixed"

    def question_types(self) -> list[str]:
        """Return the Rails-matched ordered categories for this frozen question plan."""
        cycle = {"mixed": ("behavioral", "technical", "knowledge"), "behavioral": ("behavioral",),
            "technical": ("technical", "knowledge"), "screening": ("screening",)}[self.question_format]
        return [cycle[i % len(cycle)] for i in range(self.question_count)]
