"""Bounded frozen career sources and a cited summary proposal; no destination writes.

Library sources carry the `record_id` of the saved row they came from; the label names
its record type and field. The worker reports screening receipts for those rows, which
Rails checks against this frozen copy. Saved-resume copies and older snapshots have no
record id and are screened without being reported. For resume copies, `screened` means
the text matches earlier accepted AI output, not a saved screen.
"""
import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# Same sections and fields as Rails `SummaryGeneration::Snapshot::FIELDS`.
_LIBRARY_FIELDS = {
    "EXPERIENCES": ("experience", {"company", "title", "location", "description"}),
    "PROJECTS": ("project", {"name", "role", "description"}),
    "EDUCATIONS": ("education", {"institution", "degree", "field_of_study", "description"}),
    "CERTIFICATIONS": ("certification", {"name", "issuer", "description"}),
    "SKILLS": ("skill", {"name", "category"}),
    "CAREER_CONTEXTS": ("career_context", {"response"}),
}
_LIBRARY_LABEL = re.compile(rf"^({'|'.join(_LIBRARY_FIELDS)})_\d+_([A-Z_]+)$")
_HIGHLIGHT_LABEL = re.compile(r"^EXPERIENCES_\d+_HIGHLIGHT_\d+$")


def library_identity(label: str) -> tuple[str, str] | None:
    """The screening record type and field a library label names, or None for other labels."""
    if _HIGHLIGHT_LABEL.match(label):
        return "experience_highlight", "content"
    if match := _LIBRARY_LABEL.match(label):
        record_type, fields = _LIBRARY_FIELDS[match.group(1)]
        field = match.group(2).lower()
        if field in fields:
            return record_type, field
    return None


class SummarySource(BaseModel):
    label: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,100}$")
    text: str = Field(min_length=1, max_length=20_000)
    screened: bool = False
    record_id: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def id_needs_library_label(self):
        if self.record_id is not None and library_identity(self.label) is None:
            raise ValueError("Only library source labels can carry a record id")
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
        identities = [(library_identity(source.label), source.record_id) for source in self.sources
                      if source.record_id is not None]
        if len(set(identities)) != len(identities):
            raise ValueError("Each record field can appear in only one summary source")
        return self


class SummaryProposal(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    source_labels: list[str] = Field(min_length=1, max_length=1000)
