"""Describe a generated section as cited prose or selected library entries.

A summary contains only its cited paragraph. Other writers select entries and code copies
their identity. Education and certification sections are copied without using this output.
"""

from pydantic import BaseModel, Field


class CitedProse(BaseModel):
    """Rewritten resume wording. The labels are for the checker, not the page."""

    text: str = Field(description="The rewritten sentence or bullet. Do not include source labels.")
    source_labels: list[str] = Field(
        description="Labels of the sources this wording uses, such as H1, GR1, or A1."
    )


class ChosenEntry(BaseModel):
    """One library entry the section includes."""

    label: str = Field(description="The experience, project, or skill entry to include: E1, P1, or S1. Not used for summary citations.")
    prose: list[CitedProse] = Field(
        default_factory=list,
        description="Rewritten bullets or a description, closest match first. Empty for a skill.",
    )


class TailoredSectionDraft(BaseModel):
    """One resume section written only from the labeled sources."""

    nothing_fits: bool = Field(
        description="True when none of the labeled sources belong in this section for this job."
    )
    entries: list[ChosenEntry] = Field(
        default_factory=list,
        description="Entries to include, closest match first. Always [] for summary, and when nothing_fits is true. Summary citations belong only in summary.source_labels.",
    )
    summary: CitedProse | None = Field(
        default=None,
        description="The summary paragraph with supporting source labels. Set only for the summary section; entries must then be []. Null for other sections or when nothing_fits is true.",
    )
