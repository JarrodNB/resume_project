"""
Description: Result of a scrape_job task: one job posting with its requirements split out. Rails
creates a Job from it (Jobs::CreateJobFromScrapedPostingService), so changes must be mirrored there.
Index:
    - RequirementsSortedBy: how the requirement lists were filled
    - ScrapedJobPosting: the posting sent to Rails as result["scraped_job"]
"""

from typing import Literal

from pydantic import BaseModel, Field

RequirementsSortedBy = Literal["headings", "llm", "none"]


class ScrapedJobPosting(BaseModel):
    """A scraped or pasted posting; company is null when unstated. Every requirement,
    responsibility, and nice-to-have is copied verbatim from the posting."""

    source: str
    source_url: str
    title: str
    company: str | None = None
    location: str | None = None
    description: str = Field(default="", description="The posting's description as plain text.")
    requirements: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)
    requirements_sorted_by: RequirementsSortedBy = Field(
        description="'headings' when the posting's own headings labelled the bullets, 'llm' when "
        "the sorting agent chose among the bullets, 'none' when there were no bullets to sort."
    )
    warnings: list[str] = Field(default_factory=list)
