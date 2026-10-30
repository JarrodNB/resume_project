"""Bounded frozen career sources and a cited summary proposal; no destination writes.

Library sources name the saved row and field they came from, so the worker can report
screening receipts that Rails checks against this frozen copy. Saved-resume copies and
older snapshots have no record id and are screened without being reported. For resume
copies, `screened` means the text matches earlier accepted AI output, not a saved screen.
"""
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SummarySource(BaseModel):
    label: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,100}$")
    text: str = Field(min_length=1, max_length=20_000)
    screened: bool = False
    record_type: Literal["user", "experience", "experience_highlight", "project", "education",
                         "certification", "skill", "career_context"] | None = None
    record_id: str | None = Field(default=None, min_length=1, max_length=100)
    field: str | None = Field(default=None, pattern=r"^[a-z][a-z_]{0,50}$")

    @model_validator(mode="after")
    def complete_identity(self):
        if (self.record_type is None) != (self.record_id is None) or (self.record_id is None) != (self.field is None):
            raise ValueError("A summary source names its record type, id and field together or not at all")
        return self


class SummaryGenerationInput(BaseModel):
    target_kind: Literal["profile", "resume"]
    target_id: str
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    sources: list[SummarySource] = Field(max_length=1000)

    @model_validator(mode="after")
    def unique_labels(self):
        if len({source.label for source in self.sources}) != len(self.sources):
            raise ValueError("Summary source labels must be unique")
        return self


class SummaryProposal(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    source_labels: list[str] = Field(min_length=1, max_length=1000)
