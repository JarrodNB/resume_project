"""
Description: The tailor_resume task input Rails sends, including the generation counter the
result must echo.
Index:
    - ApprovedSection / PendingSection / TailorResumeInput: the input fields
    - section_snapshot: one approved or omitted section
    - section_plain_text: the text of a section a user just submitted, for the screen
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from tailoring.section_catalog import SECTION_TITLES

SectionAction = Literal["approve", "omit", "write_anyway", "reopen"]


class ApprovedSection(BaseModel):
    """A section the user has accepted, or chosen to leave out."""

    section_type: str
    title: str
    content: dict[str, Any] = Field(default_factory=dict)
    omitted: bool = False


class PendingSection(BaseModel):
    """What the user just did with the section that was open."""

    section_type: str
    action: SectionAction
    content: dict[str, Any] = Field(default_factory=dict)


class TailorResumeInput(BaseModel):
    """Input of a tailor_resume task. The same task is requeued with a new generation."""

    job_id: UUID
    generation: int = 0
    contact: dict[str, Any] = Field(default_factory=dict)
    gap_analysis: dict[str, Any] | None = None
    gap_responses: list[dict[str, str]] = Field(default_factory=list)
    approved_sections: list[ApprovedSection] = Field(default_factory=list)
    pending_section: PendingSection | None = None


def section_snapshot(section_type: str, content: dict[str, Any], *, omitted: bool) -> ApprovedSection:
    """One section as stored on the task and, later, on the resume."""
    return ApprovedSection(
        section_type=section_type,
        title=SECTION_TITLES[section_type],
        content={} if omitted else content,
        omitted=omitted,
    )


def section_plain_text(content: dict[str, Any]) -> str:
    """Every string in a submitted section, which is what Jev screens."""
    parts: list[str] = []

    def walk(value: object) -> None:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(content)
    return "\n".join(parts)
