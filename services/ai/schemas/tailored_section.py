"""
Description: What the tailoring agent returns for one written section. Employers, titles,
dates, and skill names are not fields here: the model picks a source label and writes prose,
and code copies the identity from that label.
Index:
    - CitedProse: rewritten text plus the labels it drew from
    - ChosenEntry: one library entry to include, with its rewritten prose
    - TailoredSectionDraft: the section, or nothing_fits when no source belongs
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

    label: str = Field(description="The entry to include, such as E1, P1, ED1, C1, or S1.")
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
        description="Entries to include, closest match first. Empty when nothing_fits is true.",
    )
    summary: CitedProse | None = Field(
        default=None,
        description="The summary paragraph. Set only when the section is the summary.",
    )
