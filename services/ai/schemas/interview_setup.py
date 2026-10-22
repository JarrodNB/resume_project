"""Validate frozen interview choices supplied by Rails, including legacy nine-question plans."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class InterviewSetup(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    question_count: Literal[5, 8, 9, 12]
    question_format: Literal["mixed", "behavioral", "technical", "screening"] = "mixed"
    difficulty: Literal["warm_up", "realistic", "stretch"] = "realistic"
    interviewer: Literal["maya", "daniel", "priya"] = "daniel"
    focus_areas: list[Literal["communication", "problem_solving", "leadership", "teamwork", "conflict",
        "impact_metrics", "technical_depth", "adaptability", "ownership", "customer_focus"]] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def distinct_focus(self):
        if len(set(self.focus_areas)) != len(self.focus_areas):
            raise ValueError("Focus areas must be distinct")
        return self

    def question_types(self) -> list[str]:
        """Return the Rails-matched ordered categories for this frozen question plan."""
        cycle = {"mixed": ("behavioral", "technical", "knowledge"), "behavioral": ("behavioral",),
            "technical": ("technical", "knowledge"), "screening": ("screening",)}[self.question_format]
        return [cycle[i % len(cycle)] for i in range(self.question_count)]
