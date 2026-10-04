"""
Description: Turns a GapAnalysisContext into the agent's user prompt. Every requirement and every
career library entry gets a short label (R1, N1, E1, H1, P1, ED1, S1, SUMMARY): models copy short
labels reliably (unlike UUIDs) and they cost fewer tokens. The returned maps let the validator
check the labels and the worker swap them back for ids and text.
Index:
    - LabeledRequirement: one requirement with its kind and text
    - GapAnalysisPrompt: prompt text plus the requirement and evidence label maps
    - build_gap_analysis_prompt: builds the prompt for one context
    - format_date_range: "Jan 2020 – present" style ranges
"""

from dataclasses import dataclass, field
from datetime import date

from schemas.gap_analysis import EvidenceItem, RequirementKind
from schemas.gap_analysis_context import GapAnalysisContext

SUMMARY_REF = "SUMMARY"


@dataclass(frozen=True)
class LabeledRequirement:
    """A job requirement or nice-to-have, as numbered in the prompt."""

    kind: RequirementKind
    text: str


@dataclass
class GapAnalysisPrompt:
    """The prompt and what its labels stand for (both maps keep prompt order)."""

    text: str
    requirements: dict[str, LabeledRequirement] = field(default_factory=dict)
    evidence: dict[str, EvidenceItem] = field(default_factory=dict)


def format_date_range(start_date: date | None, end_date: date | None) -> str | None:
    """Formats a date range as months, "present" for an ongoing entry; None if undated."""
    if start_date is None and end_date is None:
        return None
    start = start_date.strftime("%b %Y") if start_date else "?"
    end = end_date.strftime("%b %Y") if end_date else "present"
    return f"{start} – {end}"


def build_gap_analysis_prompt(context: GapAnalysisContext, today: date) -> GapAnalysisPrompt:
    """Builds the labeled prompt. `today` lets the model count years for ongoing roles."""
    prompt = GapAnalysisPrompt(text="")
    lines = [
        f"Today's date: {today.isoformat()}",
        "",
        f"# Job: {context.job.title} at {context.job.company}",
    ]
    lines += _requirement_lines(prompt, "required", "R", "Requirements", context.job.requirements)
    lines += _requirement_lines(
        prompt, "nice_to_have", "N", "Nice to have", context.job.nice_to_haves
    )
    lines += ["", "# Career library"]
    lines += _library_lines(prompt, context)
    prompt.text = "\n".join(lines)
    return prompt


def _requirement_lines(
    prompt: GapAnalysisPrompt, kind: RequirementKind, prefix: str, heading: str, texts: list[str]
) -> list[str]:
    """Labels one list of requirements and returns its prompt lines."""
    if not texts:
        return []
    lines = ["", f"## {heading}"]
    for number, text in enumerate(texts, start=1):
        ref = f"{prefix}{number}"
        prompt.requirements[ref] = LabeledRequirement(kind=kind, text=text)
        lines.append(f"[{ref}] {text}")
    return lines


def _add_evidence(prompt: GapAnalysisPrompt, ref: str, item: EvidenceItem) -> str:
    """Registers a library entry under its label and returns the label."""
    prompt.evidence[ref] = item
    return ref


def _join(*parts: str | None, separator: str = ", ") -> str:
    """Joins the non-empty parts."""
    return separator.join(part for part in parts if part)


def _library_lines(prompt: GapAnalysisPrompt, context: GapAnalysisContext) -> list[str]:
    """Labels every library entry and returns the career library part of the prompt."""
    library = context.career_library
    lines: list[str] = []
    if library.summary:
        _add_evidence(prompt, SUMMARY_REF, EvidenceItem(kind="summary", text=library.summary))
        lines += ["", "## Summary", f"[{SUMMARY_REF}] {library.summary}"]

    if library.experiences:
        lines += ["", "## Experience"]
    highlight_number = 0
    for number, experience in enumerate(library.experiences, start=1):
        role = f"{experience.title} at {experience.company}"
        text = _join(role, experience.description, separator=": ")
        ref = _add_evidence(
            prompt, f"E{number}", EvidenceItem(kind="experience", id=experience.id, text=text)
        )
        dates = format_date_range(experience.start_date, experience.end_date)
        lines.append(f"[{ref}] {_join(role, dates, experience.location, separator=' | ')}")
        if experience.description:
            lines.append(f"  {experience.description}")
        for highlight in experience.highlights:
            highlight_number += 1
            item = EvidenceItem(
                kind="highlight", id=highlight.id, text=highlight.content, context=role
            )
            lines.append(
                f"  [{_add_evidence(prompt, f'H{highlight_number}', item)}] {highlight.content}"
            )

    if library.projects:
        lines += ["", "## Projects"]
    for number, project in enumerate(library.projects, start=1):
        name = _join(project.name, f"({project.role})" if project.role else None, separator=" ")
        text = _join(name, project.description, separator=": ")
        ref = _add_evidence(
            prompt, f"P{number}", EvidenceItem(kind="project", id=project.id, text=text)
        )
        dates = format_date_range(project.start_date, project.end_date)
        lines.append(f"[{ref}] {_join(name, dates, separator=' | ')}")
        if project.description:
            lines.append(f"  {project.description}")

    if library.educations:
        lines += ["", "## Education"]
    for number, education in enumerate(library.educations, start=1):
        text = _join(education.degree, education.field_of_study, education.institution)
        ref = _add_evidence(
            prompt, f"ED{number}", EvidenceItem(kind="education", id=education.id, text=text)
        )
        dates = format_date_range(education.start_date, education.end_date)
        lines.append(f"[{ref}] {_join(text, dates, separator=' | ')}")
        if education.description:
            lines.append(f"  {education.description}")

    if library.skills:
        lines += ["", "## Skills"]
    for number, skill in enumerate(library.skills, start=1):
        item = EvidenceItem(kind="skill", id=skill.id, text=skill.name, context=skill.category)
        category = f" ({skill.category})" if skill.category else ""
        lines.append(f"[{_add_evidence(prompt, f'S{number}', item)}] {skill.name}{category}")

    if not lines:
        lines.append("(empty)")
    return lines
