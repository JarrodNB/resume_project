"""Let the importer choose career record kinds while keeping their fields typed.

Source references are request-local; trusted assembly supplies highlight wording.
"""

from functools import reduce
from operator import or_
from typing import Annotated, Literal, TypeAliasType

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


class SourceRecord(StrictFields):
    """Locate a record using an exact bare label from the current chunk."""

    source_id: str = Field(description="Bare source ID, e.g. S6, never [S6] or source text.")


class SupportedRecord(SourceRecord):
    """Cite additional passages represented by a non-experience record's fields."""

    supporting_ids: list[str] = Field(
        default_factory=list,
        description="Bare IDs of additional source passages represented in these fields. "
        "Cite bullets used in descriptions, skills or summary so they are not left for placement. "
        "A source may support several related records; do not invent or rewrite its facts.",
    )


class ExperienceRecord(SourceRecord):
    type: Literal["experience"]
    fields: ExperienceFields


class ProjectRecord(SupportedRecord):
    type: Literal["project"]
    fields: ProjectFields


class EducationRecord(SupportedRecord):
    type: Literal["education"]
    fields: EducationFields


class CertificationRecord(SupportedRecord):
    type: Literal["certification"]
    fields: CertificationFields


class SkillRecord(SupportedRecord):
    type: Literal["skill"]
    fields: SkillFields


class ContactRecord(SupportedRecord):
    type: Literal["contact"]
    fields: ContactFields


class SummaryFields(StrictFields):
    text: str


class SummaryRecord(SupportedRecord):
    type: Literal["summary"]
    fields: SummaryFields


class UnassignedReference(SourceRecord):
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


# This is an internal schema-size budget, not an input or provider acceptance limit.
# Longer resumes retain exact membership checks in ResumeSource after extraction.
_MAX_ENUMERATED_IDS = 256


def _source_id_type(name: str, source_ids: tuple[str, ...]):
    values = (
        Literal[source_ids]
        if source_ids and len(source_ids) <= _MAX_ENUMERATED_IDS
        else Annotated[str, Field(pattern=r"^S[1-9][0-9]*$")]
    )
    return TypeAliasType(name, values)


def source_bound_extraction(source_ids: tuple[str, ...], bullet_ids: tuple[str, ...]):
    """Give the provider the exact bare IDs this chunk may cite, including retry guidance.

    Empty chunks allow no records; chunks without bullets allow no highlight references.
    Named ID definitions avoid repeating enums. Long-source schemas use compact bare-ID
    syntax and retain exact ownership checks in ResumeSource rather than rejecting input.
    Dynamic types retain strict fields and the public discriminated record structure.
    """

    from pydantic import create_model

    source_type = _source_id_type("OwnedSourceId", source_ids)
    bullet_type = _source_id_type("OwnedBulletId", bullet_ids) if bullet_ids else source_type
    records = []
    for record_type in (
        ExperienceRecord,
        ProjectRecord,
        EducationRecord,
        CertificationRecord,
        SkillRecord,
        ContactRecord,
        SummaryRecord,
    ):
        overrides = {
            "source_id": (
                source_type,
                Field(description=SourceRecord.model_fields["source_id"].description),
            )
        }
        if record_type is ExperienceRecord:
            fields = create_model(
                "BoundExperienceFields",
                __base__=ExperienceFields,
                highlight_ids=(
                    list[bullet_type],
                    Field(
                        default_factory=list,
                        max_length=None if bullet_ids else 0,
                        description="Bare IDs of owned source bullets, e.g. S10; never [S10] or source text.",
                    ),
                ),
            )
            overrides["fields"] = (fields, ...)
        else:
            overrides["supporting_ids"] = (
                list[source_type],
                Field(
                    default_factory=list,
                    description=SupportedRecord.model_fields["supporting_ids"].description,
                ),
            )
        records.append(
            create_model(f"Bound{record_type.__name__}", __base__=record_type, **overrides)
        )
    unassigned = create_model(
        "BoundUnassignedReference",
        __base__=UnassignedReference,
        source_id=(
            bullet_type,
            Field(description="Bare owned bullet ID, e.g. S10; never [S10] or source text."),
        ),
    )
    record_union = Annotated[reduce(or_, records), Field(discriminator="type")]
    return create_model(
        "SourceBoundResumeImportExtraction",
        __base__=ResumeImportExtraction,
        records=(
            list[record_union],
            Field(default_factory=list, max_length=None if source_ids else 0),
        ),
        unassigned_highlights=(
            list[unassigned],
            Field(default_factory=list, max_length=None if bullet_ids else 0),
        ),
    )
