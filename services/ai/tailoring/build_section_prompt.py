"""
Description: The user prompt for one written section: the job, the labeled sources for that
section, and the sections already approved.
Index:
    - SectionPrompt: the prompt text and the label map the checker uses
    - build_section_prompt: builds it, including a write-anyway note when the user asked
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime

from schemas.certification_dates import certification_expiry_status
from schemas.gap_analysis_context import GapAnalysisContext
from tailoring.labeled_sources import LabeledSources, label_sources
from tailoring.section_catalog import SECTION_TITLES

_WRITE_ANYWAY = (
    "The user asked you to write this section anyway. Use the closest sources and set "
    "nothing_fits to false when any source can be used without adding a fact."
)
_SECTION_NOTE = {
    "education": "Every source labeled ED is this person's education. Include each one.",
    "certifications": "Every source labeled C is a certification. Include the relevant credentials; do not claim an expired credential is current.",
    "projects": "Every source labeled P is a project. Include each one that belongs on this resume.",
    "skills": "Every source labeled S is a skill. Include the ones this job needs.",
}


@dataclass(frozen=True)
class SectionPrompt:
    """One section's prompt and the sources its labels name."""

    text: str
    sources: LabeledSources
    section_type: str


def build_section_prompt(
    section_type: str,
    context: GapAnalysisContext,
    gap_responses: list[dict[str, str]],
    approved_sections: list[dict[str, object]],
    retrieved: set[tuple[str, str]] | None,
    *,
    write_anyway: bool,
    gap_analysis: dict[str, object] | None,
    today: date | None = None,
) -> SectionPrompt:
    """Builds the prompt for one section. Retrieval narrows the library; gap responses and
    approved sections are always listed."""
    sources = label_sources(context, gap_responses, approved_sections, retrieved, section_type)
    today = today or datetime.now(UTC).date()
    expiry_statuses = [
        f"{item.name}: {certification_expiry_status(item.expiry_date, item.expiry_date_precision, today)}"
        for item in context.career_library.certifications
    ]
    lines = [
        f"Today's date: {today.isoformat()}",
        "Credential expiry status: " + "; ".join(expiry_statuses) if expiry_statuses else "",
        f"# Write the {SECTION_TITLES[section_type]} section",
        _SECTION_NOTE.get(section_type, ""),
        _WRITE_ANYWAY if write_anyway else "",
        "",
        f"# Job: {context.job.title} at {context.job.company}",
        *_bullets("Requirements", context.job.requirements),
        *_bullets("Nice to have", context.job.nice_to_haves),
        *_gap_analysis_lines(gap_analysis),
        "",
        "# Sources",
        *_source_lines(sources),
    ]
    return SectionPrompt(
        text="\n".join(line for line in lines if line is not None),
        sources=sources,
        section_type=section_type,
    )


def _bullets(heading: str, items: list[str]) -> list[str]:
    """A heading and one bullet per item, or nothing when the list is empty."""
    if not items:
        return []
    return ["", f"## {heading}", *[f"- {item}" for item in items]]


def _gap_analysis_lines(gap_analysis: dict[str, object] | None) -> list[str]:
    """The comparison's summary, when the task carried one."""
    if not gap_analysis:
        return []
    summary = gap_analysis.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return []
    return ["", "## How the library matches this job", summary.strip()]


def _source_lines(sources: LabeledSources) -> list[str]:
    """One line per label, in label order."""
    if not sources.records:
        return ["(none)"]
    return [f"[{label}] {record.text}" for label, record in sources.records.items()]
