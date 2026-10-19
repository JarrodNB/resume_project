"""
Description: Structured output of the resume parsing agent. Mirrors the Rails career library
(experiences + highlights, projects, educations, certifications, skills) plus contact info and summary.
Index:
    - ParsedLink: one contact link's visible label and destination URL
    - ParsedContactInfo: name, email, phone, location, links
    - ParsedExperience: one role with word-for-word highlights
    - ParsedProject: one project
    - ParsedEducation: one school or program
    - ParsedCertification: one certification and its stated credential details
    - ParsedSkill: one skill, with the resume's own grouping if any
    - ParsedResume: the full parse result (the agent's output_type)
"""

from pydantic import BaseModel, Field

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


class ParsedExperience(BaseModel):
    """One role at one company."""

    company: str
    title: str
    location: str | None = None
    start_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    end_date: str | None = Field(
        default=None, description=f"{PARTIAL_DATE_DESCRIPTION} Null when is_current is true."
    )
    is_current: bool = False
    description: str | None = Field(
        default=None, description="Intro text for the role that is not a bullet point."
    )
    highlights: list[str] = Field(
        default_factory=list, description="Bullet points, copied word for word."
    )


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


class ExperienceExtraction(BaseModel):
    """Internal output: roles cite request-local source bullet IDs, never rewrite them."""

    experiences: list["ExperienceRoleExtraction"] = Field(default_factory=list)
    parsing_warnings: list[str] = Field(default_factory=list)


class ExperienceRoleExtraction(BaseModel):
    """A role matched to source bullets; the parser restores public highlight text."""

    company: str
    title: str
    location: str | None = None
    start_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    end_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    is_current: bool = False
    description: str | None = None
    highlight_ids: list[str] = Field(default_factory=list)


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
