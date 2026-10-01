"""
Description: Structured output of the resume parsing agent. Mirrors the Rails career library
(experiences + highlights, projects, educations, skills) plus contact info and summary.
Index:
    - ParsedContactInfo: name, email, phone, location, links
    - ParsedExperience: one role with word-for-word highlights
    - ParsedProject: one project
    - ParsedEducation: one school or program
    - ParsedSkill: one skill, with the resume's own grouping if any
    - ParsedResume: the full parse result (the agent's output_type)
"""

from pydantic import BaseModel, Field

PARTIAL_DATE_DESCRIPTION = (
    "'YYYY-MM' or 'YYYY', only as precise as the resume states. Null if not stated."
)


class ParsedContactInfo(BaseModel):
    """How to reach the candidate, as written on the resume."""

    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    links: list[str] = Field(
        default_factory=list, description="LinkedIn, GitHub, portfolio, etc., as written."
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
    """A school, degree, bootcamp, or certification program."""

    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    start_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    end_date: str | None = Field(default=None, description=PARTIAL_DATE_DESCRIPTION)
    description: str | None = Field(default=None, description="Honours, GPA, coursework.")


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
    skills: list[ParsedSkill] = Field(default_factory=list)
    parsing_warnings: list[str] = Field(
        default_factory=list,
        description="Anything ambiguous or skipped, e.g. unclear whether an entry is a job.",
    )
