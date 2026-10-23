"""
Description: Turns a GapAnalysisContext into the agent's user prompt. Every requirement and every
career library entry gets a short label (R1, N1, E1, H1, P1, ED1, C1, S1, F1): models copy short
labels reliably (unlike UUIDs) and they cost fewer tokens. The profile summary is unlabeled
background for the overall writeup, not evidence. The returned maps let the validator
check the labels and the worker swap them back for ids and text.
Index:
    - LabeledRequirement: one requirement with its kind and text
    - GapAnalysisPrompt: prompt text plus the requirement and evidence label maps
    - build_gap_analysis_prompt: builds the prompt for one context
    - format_date_range: "Jan 2020 – present" style ranges
"""

from dataclasses import dataclass, field
from datetime import date

from schemas.certification_dates import format_certification_date
from schemas.gap_analysis import EvidenceItem, RequirementKind
from schemas.gap_analysis_context import GapAnalysisContext


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
    warnings: list[str] = field(default_factory=list)


def format_date_range(start_date: date | None, end_date: date | None) -> str | None:
    """Formats a date range as months, "present" for an ongoing entry; None if undated."""
    if start_date is None and end_date is None:
        return None
    start = start_date.strftime("%b %Y") if start_date else "?"
    end = end_date.strftime("%b %Y") if end_date else "present"
    return f"{start} – {end}"


def build_gap_analysis_prompt(context: GapAnalysisContext, today: date) -> GapAnalysisPrompt:
    """Label the complete supplied context; production preparation owns required screening."""
    prompt = GapAnalysisPrompt(text="")
    lines = [
        f"Today's date: {today.isoformat()}",
        "",
        f"# Job: {context.job.title} at {context.job.company or 'Unknown company'}",
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
        lines += [
            "",
            "## Profile summary",
            "Background for the overall summary only. Not evidence, and it has no label.",
            library.summary,
        ]

    if library.experiences:
        lines += ["", "## Experience"]
    highlight_number = 0
    for number, experience in enumerate(library.experiences, start=1):
        grouped = len(experience.roles) > 1
        role = (experience.company if grouped else
                f"{experience.roles[0].title} at {experience.company}" if experience.roles else
                experience.company)
        role_details = [
            _join(item.title, format_date_range(item.start_date, item.end_date),
                  item.description, separator=" | ")
            for item in experience.roles
        ]
        text = _join(role, "; ".join(role_details) if grouped else
                     experience.roles[0].description if experience.roles else None,
                     experience.description, separator=": ")
        ref = _add_evidence(
            prompt, f"E{number}", EvidenceItem(kind="experience", id=experience.id, text=text)
        )
        dates = (format_date_range(experience.roles[0].start_date, experience.roles[0].end_date)
                 if len(experience.roles) == 1 else None)
        lines.append(f"[{ref}] {_join(role, dates, experience.location, separator=' | ')}")
        if experience.description:
            lines.append(f"  {experience.description}")
        if grouped:
            for detail in role_details:
                lines.append(f"  Role: {detail}")
        elif experience.roles and experience.roles[0].description:
            lines.append(f"  {experience.roles[0].description}")
        for highlight in experience.highlights:
            highlight_number += 1
            owner = next((item for item in experience.roles
                          if item.id and item.id == highlight.experience_role_id), None)
            if owner:
                highlight_context = _join(
                    f"{owner.title} at {experience.company}",
                    format_date_range(owner.start_date, owner.end_date), separator=" | ")
            elif grouped:
                highlight_context = f"Shared across roles at {experience.company} (role and dates unspecified)"
            else:
                highlight_context = role
            item = EvidenceItem(
                kind="highlight", id=highlight.id, text=highlight.content, context=highlight_context
            )
            scope = f" ({highlight_context})" if grouped else ""
            lines.append(
                f"  [{_add_evidence(prompt, f'H{highlight_number}', item)}] {highlight.content}{scope}"
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

    if library.certifications:
        lines += ["", "## Certifications"]
    for number, certification in enumerate(library.certifications, start=1):
        details = _join(certification.name, certification.issuer, certification.description)
        dates = _join(
            f"issued {format_certification_date(certification.issued_date, certification.issued_date_precision)}" if certification.issued_date else None,
            f"expires {format_certification_date(certification.expiry_date, certification.expiry_date_precision)}" if certification.expiry_date else None,
        )
        text = _join(details, dates, certification.credential_id, certification.credential_url)
        item = EvidenceItem(kind="certification", id=certification.id, text=text)
        lines.append(f"[{_add_evidence(prompt, f'C{number}', item)}] {text}")

    if library.skills:
        lines += ["", "## Skills"]
    for number, skill in enumerate(library.skills, start=1):
        item = EvidenceItem(kind="skill", id=skill.id, text=skill.name, context=skill.category)
        category = f" ({skill.category})" if skill.category else ""
        lines.append(f"[{_add_evidence(prompt, f'S{number}', item)}] {skill.name}{category}")

    if library.facts:
        lines += ["", "## Facts"]
    for number, fact in enumerate(library.facts, start=1):
        item = EvidenceItem(kind="fact", id=fact.id, text=fact.response, context=fact.requirement)
        ref = _add_evidence(prompt, f"F{number}", item)
        lines.append(f"[{ref}] {fact.requirement}: {fact.response}")

    if not lines:
        lines.append("(empty)")
    return lines
