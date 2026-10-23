"""Let the importer choose career record kinds while keeping their fields typed.

Source references are request-local; trusted assembly supplies highlight wording.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from schemas.parsed_resume import (
    ExperienceRoleExtraction,
    ParsedCertification,
    ParsedContactInfo,
    ParsedEducation,
    ParsedLink,
    ParsedProject,
    ParsedSkill,
)


class StrictFields(BaseModel):
    """Reject accidental properties rather than silently losing extracted data."""

    model_config = ConfigDict(extra="forbid")


class ExperienceFields(ExperienceRoleExtraction, StrictFields):
    pass


class ProjectFields(ParsedProject, StrictFields):
    pass


class EducationFields(ParsedEducation, StrictFields):
    pass


class CertificationFields(ParsedCertification, StrictFields):
    pass


class SkillFields(ParsedSkill, StrictFields):
    pass


class LinkFields(ParsedLink, StrictFields):
    pass


class ContactFields(ParsedContactInfo, StrictFields):
    links: list[LinkFields] = Field(default_factory=list)


class ExperienceRecord(StrictFields):
    type: Literal["experience"]
    source_id: str
    fields: ExperienceFields


class ProjectRecord(StrictFields):
    type: Literal["project"]
    source_id: str
    fields: ProjectFields


class EducationRecord(StrictFields):
    type: Literal["education"]
    source_id: str
    fields: EducationFields


class CertificationRecord(StrictFields):
    type: Literal["certification"]
    source_id: str
    fields: CertificationFields


class SkillRecord(StrictFields):
    type: Literal["skill"]
    source_id: str
    fields: SkillFields


class ContactRecord(StrictFields):
    type: Literal["contact"]
    source_id: str
    fields: ContactFields


class SummaryFields(StrictFields):
    text: str


class SummaryRecord(StrictFields):
    type: Literal["summary"]
    source_id: str
    fields: SummaryFields


class UnassignedReference(StrictFields):
    source_id: str
    reason: Literal["ambiguous_role", "missing_role"]


Record = Annotated[
    ExperienceRecord
    | ProjectRecord
    | EducationRecord
    | CertificationRecord
    | SkillRecord
    | ContactRecord
    | SummaryRecord,
    Field(discriminator="type"),
]


class ResumeImportExtraction(StrictFields):
    """Any mixture of supported records, with ambiguous bullets kept for placement."""

    records: list[Record] = Field(default_factory=list)
    unassigned_highlights: list[UnassignedReference] = Field(default_factory=list)
    parsing_warnings: list[str] = Field(default_factory=list)
