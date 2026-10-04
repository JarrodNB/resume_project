"""
Description: What the gap analysis agent compares: one saved job and the user's career library,
as read from the database (database/career_library_reader.py) or built from eval cases.
Index:
    - LibraryHighlight / LibraryExperience / LibraryProject / LibraryEducation / LibrarySkill:
      career library entries, each with its database id
    - CareerLibrary: everything in the user's library, plus the profile summary
    - JobToAnalyze: the job's title, company, requirements, and nice-to-haves
    - GapAnalysisContext: the job and the library together
"""

from datetime import date

from pydantic import BaseModel, Field


class LibraryHighlight(BaseModel):
    """One bullet point under a role."""

    id: str
    content: str


class LibraryExperience(BaseModel):
    """A role the user has held."""

    id: str
    company: str
    title: str
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    highlights: list[LibraryHighlight] = Field(default_factory=list)


class LibraryProject(BaseModel):
    """A project the user worked on."""

    id: str
    name: str
    role: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class LibraryEducation(BaseModel):
    """A degree, course, or other education entry."""

    id: str
    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class LibrarySkill(BaseModel):
    """A skill, optionally grouped by category."""

    id: str
    name: str
    category: str | None = None


class CareerLibrary(BaseModel):
    """The user's career library: the only evidence the analysis may use."""

    summary: str | None = None
    experiences: list[LibraryExperience] = Field(default_factory=list)
    projects: list[LibraryProject] = Field(default_factory=list)
    educations: list[LibraryEducation] = Field(default_factory=list)
    skills: list[LibrarySkill] = Field(default_factory=list)

    def is_empty(self) -> bool:
        """True when there are no entries at all (a summary alone doesn't count)."""
        return not (self.experiences or self.projects or self.educations or self.skills)


class JobToAnalyze(BaseModel):
    """The saved job whose requirements are checked."""

    id: str
    title: str
    company: str
    requirements: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)


class GapAnalysisContext(BaseModel):
    """The job and the career library it is compared against."""

    job: JobToAnalyze
    career_library: CareerLibrary
