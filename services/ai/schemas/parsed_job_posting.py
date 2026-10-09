"""
Description: Structured fields the parse-job-posting agent copies out of a pasted advertisement.
Rails does not read this model; the handler turns it into a ScrapedJobPosting first.
Index:
    - ParsedJobPosting: the agent's output_type
"""

from pydantic import BaseModel, Field


class ParsedJobPosting(BaseModel):
    """Fields copied from a pasted job ad. Every string must appear in the ad."""

    title: str = Field(description="The job title, copied from the ad.")
    company: str = Field(description="The hiring company, copied from the ad.")
    location: str | None = Field(
        default=None, description="Where the job is, copied from the ad, or null if unstated."
    )
    url: str | None = Field(
        default=None, description="An http or https link that appears in the ad, or null."
    )
    requirements: list[str] = Field(
        default_factory=list,
        description="Must-have qualifications, each copied word for word from the ad.",
    )
    responsibilities: list[str] = Field(
        default_factory=list,
        description="What the person will do in the job, each copied word for word from the ad.",
    )
    nice_to_haves: list[str] = Field(
        default_factory=list,
        description="Optional qualifications, each copied word for word from the ad.",
    )
