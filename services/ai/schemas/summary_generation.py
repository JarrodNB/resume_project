"""Bounded frozen career sources and a cited summary proposal; no destination writes."""
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SummarySource(BaseModel):
    label: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,100}$")
    text: str = Field(min_length=1, max_length=20_000)
    screened: bool = False


class SummaryGenerationInput(BaseModel):
    target_kind: Literal["profile"]
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
