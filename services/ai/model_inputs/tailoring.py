"""Render one screened tailoring section from a cohesive input snapshot."""

from dataclasses import dataclass
from datetime import date

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
class TailoringSectionInput:
    section_type: str
    today: date
    expiry_statuses: tuple[str, ...]
    write_anyway: bool
    job_context: str
    analysis_text: str | None
    sources: tuple[tuple[str, str], ...]


def format_tailoring_section_input(section: TailoringSectionInput) -> str:
    """Preserve each approved source's label, wording, and order."""
    lines = [
        f"Today's date: {section.today.isoformat()}",
        "Credential expiry status: " + "; ".join(section.expiry_statuses) if section.expiry_statuses else "",
        f"# Write the {SECTION_TITLES[section.section_type]} section",
        _SECTION_NOTE.get(section.section_type, ""),
        _WRITE_ANYWAY if section.write_anyway else "",
        "",
        section.job_context,
    ]
    if section.analysis_text:
        lines.extend(["", section.analysis_text])
    lines.extend(["", "# Sources"])
    lines.extend(f"[{label}] {value}" for label, value in section.sources)
    return "\n".join(lines)
