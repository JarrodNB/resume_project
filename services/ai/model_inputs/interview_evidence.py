"""Render screened career-library facts for interview question and feedback prompts.

Both model inputs need the same saved evidence. Question prompts add temporary IDs so the
model can select sources without copying; feedback still receives readable evidence text.
"""

from hashlib import sha256

from gap_analysis.build_gap_analysis_prompt import format_date_range
from schemas.certification_dates import format_certification_date
from schemas.gap_analysis_context import CareerLibrary


def interview_career_evidence(library: CareerLibrary) -> tuple[str, str]:
    """Return the displayed text and exact saved strings eligible as verbatim quotes.

    Each displayed source field is registered where it is rendered. Formatted dates
    provide chronology but are not saved text and cannot validate evidence quotes.
    """
    evidence, quotes, _ = _render_interview_career_evidence(library, with_ids=False)
    return ("\n\n".join(evidence) if evidence else "None provided.", "\n".join(quotes))


def interview_question_evidence(library: CareerLibrary) -> tuple[str, dict[str, str]]:
    """Return readable evidence annotated with temporary IDs and their saved source text."""
    evidence, _, evidence_by_id = _render_interview_career_evidence(library, with_ids=True)
    return ("\n\n".join(evidence) if evidence else "None provided.", evidence_by_id)


def _render_interview_career_evidence(library: CareerLibrary, with_ids: bool):
    evidence: list[str] = []
    quotes: list[str] = []
    evidence_by_id: dict[str, str] = {}

    def show(lines: list[str], label: str, value: str) -> None:
        if value.strip():
            evidence_id = f"E{len(evidence_by_id) + 1}"
            prefix = f"[{evidence_id}] " if with_ids else ""
            lines.append(f"{prefix}{label}: {value}")
            quotes.append(value)
            evidence_by_id[evidence_id] = value
        else:
            lines.append(f"{label}: {value}")

    if library.summary and library.summary.strip():
        lines: list[str] = []
        show(lines, "Summary", library.summary)
        evidence.append("\n".join(lines))
    for role in library.experiences:
        if with_ids:
            lines = []
            show(lines, "Experience title", role.title)
            show(lines, "Experience company", role.company)
        else:
            lines = [f"Experience: {role.title} at {role.company}"]
            quotes.extend(value for value in (role.title, role.company) if value.strip())
        if role.location and role.location.strip():
            show(lines, "Location", role.location)
        if dates := format_date_range(role.start_date, role.end_date):
            lines.append(f"Dates: {dates}")
        if role.description and role.description.strip():
            show(lines, "Description", role.description)
        for item in role.highlights:
            if item.content.strip():
                show(lines, "Highlight", item.content)
        evidence.append("\n".join(lines))
    for project in library.projects:
        lines = []
        show(lines, "Project", project.name)
        if dates := format_date_range(project.start_date, project.end_date):
            lines.append(f"Dates: {dates}")
        if project.role and project.role.strip():
            show(lines, "Role", project.role)
        if project.description and project.description.strip():
            show(lines, "Description", project.description)
        evidence.append("\n".join(lines))
    for education in library.educations:
        lines = []
        show(lines, "Education", education.institution)
        if dates := format_date_range(education.start_date, education.end_date):
            lines.append(f"Dates: {dates}")
        for label, value in (("Degree", education.degree), ("Field", education.field_of_study),
                             ("Description", education.description)):
            if value and value.strip():
                show(lines, label, value)
        evidence.append("\n".join(lines))
    for certificate in library.certifications:
        lines = []
        show(lines, "Certification", certificate.name)
        for label, value in (("Issuer", certificate.issuer), ("Description", certificate.description)):
            if value and value.strip():
                show(lines, label, value)
        if certificate.issued_date:
            lines.append(f"Issued: {format_certification_date(certificate.issued_date, certificate.issued_date_precision)}")
        if certificate.expiry_date:
            lines.append(f"Expires: {format_certification_date(certificate.expiry_date, certificate.expiry_date_precision)}")
        for label, value in (("Credential ID", certificate.credential_id),
                             ("Credential URL", certificate.credential_url)):
            if value and value.strip():
                show(lines, label, value)
        evidence.append("\n".join(lines))
    for skill in library.skills:
        if with_ids:
            lines = []
            show(lines, "Skill", skill.name)
            if skill.category and skill.category.strip():
                show(lines, "Skill category", skill.category)
        else:
            text = f"Skill: {skill.name}" + (f" ({skill.category})" if skill.category and skill.category.strip() else "")
            lines = [text]
            quotes.append(skill.name)
            if skill.category and skill.category.strip():
                quotes.append(skill.category)
        evidence.append("\n".join(lines))
    for fact in library.facts:
        if fact.response.strip():
            lines = []
            show(lines, "Career fact", fact.response)
            evidence.append("\n".join(lines))
    return evidence, quotes, evidence_by_id


def format_interview_career_evidence(library: CareerLibrary) -> str:
    """Show useful saved fields without record IDs or screening metadata."""
    return interview_career_evidence(library)[0]


def interview_data_boundary(source: str) -> str:
    """Choose a short, repeatable delimiter absent from the exact source text."""
    digest = sha256(source.encode("utf-8")).hexdigest()
    marker = f"--{digest[:8]}"
    counter = 0
    while marker in source:
        counter += 1
        marker = f"--{sha256(f'{digest}:{counter}'.encode()).hexdigest()[:8]}"
    return marker
