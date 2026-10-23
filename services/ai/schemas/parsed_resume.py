"""
Description: Structured output of the resume parsing agent. Mirrors the Rails career library
(experiences + highlights, projects, educations, certifications, skills) plus contact info and summary.
Index:
    - ParsedLink: one contact link's visible label and destination URL
    - ParsedContactInfo: name, email, phone, location, links
    - ParsedRole: one stated role and its exact source highlights
    - ParsedExperience: one source employment block with ordered roles and shared highlights
    - ParsedProject: one project
    - ParsedEducation: one school or program
    - ParsedCertification: one certification and its stated credential details
    - ParsedSkill: one skill, with the resume's own grouping if any
    - ParsedResume: the full parse result (the agent's output_type)
"""

from pydantic import BaseModel, Field, model_validator

CERTIFICATION_DATE_DESCRIPTION = (
    "YYYY-MM-DD, YYYY-MM, or YYYY: preserve exactly the precision stated. Null if not stated."
)

PARTIAL_DATE_DESCRIPTION = (
    "'YYYY-MM' or 'YYYY', only as precise as the resume states. Null if not stated."
)


class ParsedLink(BaseModel):
    """One clickable contact link exactly as represented by the resume."""

    label: str
    url: str


class ParsedContactInfo(BaseModel):
    """How to reach the candidate, as written on the resume."""

    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    links: list[ParsedLink] = Field(
        default_factory=list,
        description="LinkedIn, GitHub, portfolio, etc., with visible label and destination URL.",
    )


class ParsedRole(BaseModel):
    """One stated role within an employment entry, in source order."""

    title: str
    start_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    end_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    is_current: bool = False
    description: str | None = None
    highlights: list[str] = Field(default_factory=list, max_length=40)


def _normalize_legacy_entry(value, *, ids=False):
    """Adapt older flat results at the read boundary without changing stored JSON."""
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if isinstance(value, dict) and "roles" not in value:
        value = dict(value)
        bullet_key = "highlight_ids" if ids else "highlights"
        role = {key: value.pop(key) for key in
                ("title", "start_date", "end_date", "is_current", "description", bullet_key)
                if key in value}
        value["roles"] = [role]
    return value


class ParsedExperience(BaseModel):
    """One source employment block; repeated company blocks remain separate entries."""

    company: str
    location: str | None = None
    description: str | None = None
    roles: list[ParsedRole] = Field(min_length=1, max_length=20)
    shared_highlights: list[str] = Field(default_factory=list, max_length=40)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy(cls, value):
        return _normalize_legacy_entry(value)


class ParsedProject(BaseModel):
    """A personal, open-source, or academic project."""

    name: str
    role: str | None = None
    url: str | None = None
    start_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    end_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    description: str | None = None


class ParsedEducation(BaseModel):
    """A school, degree, or bootcamp."""

    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    start_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    end_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    description: str | None = Field(default=None, description="Honours, GPA, coursework.")


class ParsedCertification(BaseModel):
    """An explicitly stated certification, separate from education."""

    name: str
    issuer: str | None = None
    issued_date: str | None = Field(default=None, description=CERTIFICATION_DATE_DESCRIPTION)
    expiry_date: str | None = Field(default=None, description=CERTIFICATION_DATE_DESCRIPTION)
    credential_id: str | None = None
    credential_url: str | None = None
    description: str | None = None


class ParsedSkill(BaseModel):
    """One skill."""

    name: str
    category: str | None = Field(
        default=None, description="Only if the resume groups skills, e.g. 'Languages'."
    )


class ParsedResume(BaseModel):
    """Everything extracted from one resume. Nothing here may be invented."""

    contact: ParsedContactInfo = Field(default_factory=ParsedContactInfo)
    summary: str | None = None
    experiences: list[ParsedExperience] = Field(default_factory=list)
    projects: list[ParsedProject] = Field(default_factory=list)
    educations: list[ParsedEducation] = Field(default_factory=list)
    certifications: list[ParsedCertification] = Field(default_factory=list)
    skills: list[ParsedSkill] = Field(default_factory=list)
    parsing_warnings: list[str] = Field(
        default_factory=list,
        description="Anything ambiguous or skipped, e.g. unclear whether an entry is a job.",
    )


class ExperienceRoleExtraction(BaseModel):
    """One role citing exact source passages; no source text is generated."""

    title: str = Field(description="The position or job title, never the employer. In Role, Employer — dates, use Role.")
    start_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    end_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    is_current: bool = False
    description: str | None = Field(
        default=None, description="Copy non-bullet introductory text immediately under this role header, even if bullets follow. Null only when absent."
    )
    highlight_ids: list[str] = Field(default_factory=list, max_length=40)


class EmploymentExtraction(BaseModel):
    """One employer block, with ordered roles and explicitly shared source passages."""

    company: str = Field(description="The employer organization, never the job title. In Role, Employer — dates, use Employer, preserving any privacy token.")
    location: str | None = None
    description: str | None = None
    roles: list[ExperienceRoleExtraction] = Field(min_length=1, max_length=20)
    shared_highlight_ids: list[str] = Field(default_factory=list, max_length=40)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy(cls, value):
        return _normalize_legacy_entry(value, ids=True)


class ExperienceExtraction(BaseModel):
    """Internal employer blocks cite request-local IDs, globally at most once."""

    experiences: list[EmploymentExtraction] = Field(default_factory=list)
    parsing_warnings: list[str] = Field(default_factory=list)


class ProjectsSkillsExtraction(BaseModel):
    """Extract projects and the explicitly listed skills."""

    projects: list[ParsedProject] = Field(default_factory=list)
    skills: list[ParsedSkill] = Field(default_factory=list)
    parsing_warnings: list[str] = Field(default_factory=list)


class ProfileExtraction(BaseModel):
    """Extract contact, summary, education and certifications."""

    contact: ParsedContactInfo = Field(default_factory=ParsedContactInfo)
    summary: str | None = None
    educations: list[ParsedEducation] = Field(default_factory=list)
    certifications: list[ParsedCertification] = Field(default_factory=list)
    parsing_warnings: list[str] = Field(default_factory=list)
