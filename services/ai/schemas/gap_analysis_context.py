"""
Description: Shared saved-job and career-library context read from the database or eval cases.
Gap-analysis preparation projects only requirements and nice-to-haves; tailoring may also
use the saved responsibilities.
A saved job may have no company; career-library employers remain required.
Index:
    - LibraryHighlight / LibraryExperience / LibraryProject / LibraryEducation / LibraryCertification / LibrarySkill /
      LibraryFact: career library entries, each with its database id
    - CareerLibrary: everything in the user's library, plus the profile summary
    - JobToAnalyze: the job's title, company, requirements, responsibilities, and nice-to-haves
    - GapAnalysisContext: the job and the library together
"""

from datetime import date

from pydantic import BaseModel, Field, PrivateAttr, model_validator

from schemas.certification_dates import DatePrecision


class LibraryRecord(BaseModel):
    """Saved screening metadata stays outside prompt and evidence serialization."""

    screened_fields: list[str] = Field(default_factory=list, exclude=True)


class LibraryHighlight(LibraryRecord):
    """One stable experience bullet, shared or scoped to one role."""

    id: str
    content: str
    experience_role_id: str | None = None


class LibraryExperienceRole(LibraryRecord):
    """A saved title, dates, and description; only screening metadata is excluded."""

    id: str | None = None
    title: str
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None


class LibraryExperience(LibraryRecord):
    """One source employment block with roles and a stable ordered bullet list."""

    _legacy_role: bool = PrivateAttr(default=False)

    id: str
    company: str
    title: str = ""
    roles: list[LibraryExperienceRole] = Field(default_factory=list)
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    highlights: list[LibraryHighlight] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_legacy_role(self):
        """Keep old fixtures usable until callers consume canonical roles directly."""
        self._legacy_role = len(self.roles) == 1 and self.roles[0].id is None
        if not self.roles and self.title:
            self._legacy_role = True
            self.roles = [LibraryExperienceRole(
                title=self.title, start_date=self.start_date, end_date=self.end_date,
                screened_fields=[field for field in self.screened_fields if field == "title"],
            )]
        if not self._legacy_role and len(self.roles) == 1:
            role = self.roles[0]
            self.title, self.start_date, self.end_date = role.title, role.start_date, role.end_date
        elif len(self.roles) > 1:
            # A grouped entry has no single title/date attribution to project.
            self.title, self.start_date, self.end_date = "", None, None
        return self


class LibraryProject(LibraryRecord):
    """A project the user worked on."""

    id: str
    name: str
    role: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class LibraryEducation(LibraryRecord):
    """A degree, course, or other education entry."""

    id: str
    institution: str
    degree: str | None = None
    field_of_study: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class LibraryCertification(LibraryRecord):
    """An earned certification with its stated identity and validity dates."""

    id: str
    name: str
    issuer: str | None = None
    issued_date: date | None = None
    issued_date_precision: DatePrecision = "day"
    expiry_date: date | None = None
    expiry_date_precision: DatePrecision = "day"
    credential_id: str | None = None
    credential_url: str | None = None
    description: str | None = None


class LibrarySkill(LibraryRecord):
    """A skill, optionally grouped by category."""

    id: str
    name: str
    category: str | None = None


class LibraryFact(LibraryRecord):
    """A requirement the user answered and added to the career library."""

    id: str
    requirement: str
    response: str


class CareerLibrary(BaseModel):
    """The user's career library: the only evidence the analysis may use."""

    summary_record_id: str | None = Field(default=None, exclude=True)
    screened_fields: list[str] = Field(default_factory=list, exclude=True)
    summary: str | None = None
    experiences: list[LibraryExperience] = Field(default_factory=list)
    projects: list[LibraryProject] = Field(default_factory=list)
    educations: list[LibraryEducation] = Field(default_factory=list)
    certifications: list[LibraryCertification] = Field(default_factory=list)
    skills: list[LibrarySkill] = Field(default_factory=list)
    facts: list[LibraryFact] = Field(default_factory=list)

    def is_empty(self) -> bool:
        """True when there are no entries at all (a summary alone doesn't count)."""
        return not (
            self.experiences or self.projects or self.educations or self.certifications or self.skills or self.facts
        )


class JobToAnalyze(BaseModel):
    """The saved job; each workflow chooses the fields it needs for its prompt."""

    id: str
    title: str
    company: str | None = None
    requirements: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)


class GapAnalysisContext(BaseModel):
    """The job and the career library it is compared against."""

    job: JobToAnalyze
    career_library: CareerLibrary
