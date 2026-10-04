"""
Description: Output of the job requirements sorting agent. It names bullets by number only, so
the bullets' wording can never change.
Index:
    - SortedRequirementBullets: bullet numbers that are requirements / nice-to-haves
"""

from pydantic import BaseModel, Field


class SortedRequirementBullets(BaseModel):
    """Which numbered bullets are requirements and which are nice-to-haves. Bullets that are
    neither (responsibilities, benefits, company info) are left out of both lists."""

    requirement_numbers: list[int] = Field(
        default_factory=list,
        description="Numbers of bullets the candidate must have (required skills, experience, "
        "qualifications).",
    )
    nice_to_have_numbers: list[int] = Field(
        default_factory=list,
        description="Numbers of bullets that are preferred or a bonus but not required.",
    )
