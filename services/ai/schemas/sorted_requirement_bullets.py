"""
Description: Output of the job requirements sorting agent. It names bullets by number only, so
the bullets' wording can never change.
Index:
    - SortedRequirementBullets: bullet numbers that are requirements / nice-to-haves
"""

from pydantic import BaseModel, Field


class SortedRequirementBullets(BaseModel):
    """Which numbered bullets are requirements, responsibilities, or nice-to-haves. Benefits
    and company information are left out of every list."""

    requirement_numbers: list[int] = Field(
        default_factory=list,
        description="Numbers of bullets the candidate must have (required skills, experience, "
        "qualifications).",
    )
    responsibility_numbers: list[int] = Field(
        default_factory=list,
        description="Numbers of bullets describing what the person will do in the job.",
    )
    nice_to_have_numbers: list[int] = Field(
        default_factory=list,
        description="Numbers of bullets that are preferred or a bonus but not required.",
    )
