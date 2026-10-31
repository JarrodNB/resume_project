"""Text-free summary commands, transient owned evidence and cited proposals."""
import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# Same sections and fields as Rails `SummaryGeneration::SourceReferences::FIELDS`.
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


class SummarySourceReference(BaseModel):
    """An exact field identity and hash, never its content."""
    model_config = {"extra": "forbid"}
    label: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,100}$")
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    record_id: str | None = None
    section_id: str | None = None


class SummaryCommand(BaseModel):
    """A versioned request whose sources must be resolved from owned records."""
    model_config = {"extra": "forbid"}
    command_version: Literal[1]
    target_kind: Literal["profile", "resume"]
    target_id: str
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_references: list[SummarySourceReference] = Field(max_length=1000)
