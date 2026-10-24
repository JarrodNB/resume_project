"""Render screened career-library facts for interview question and feedback prompts.

Both model inputs need the same saved evidence. This keeps their field selection in one
place while each handler owns its own question, answer, and boundary framing.
"""

from gap_analysis.build_gap_analysis_prompt import format_date_range
from schemas.certification_dates import format_certification_date
from schemas.gap_analysis_context import CareerLibrary


def format_interview_career_evidence(library: CareerLibrary) -> str:
    """Show useful saved fields without record IDs or screening metadata."""
    evidence = []
    if library.summary and library.summary.strip():
        evidence.append(f"Summary: {library.summary}")
    for role in library.experiences:
        lines = [f"Experience: {role.title} at {role.company}"]
        if role.location and role.location.strip():
            lines.append(f"Location: {role.location}")
        if dates := format_date_range(role.start_date, role.end_date):
            lines.append(f"Dates: {dates}")
        if role.description and role.description.strip():
            lines.append(f"Description: {role.description}")
        lines.extend(f"Highlight: {item.content}" for item in role.highlights if item.content.strip())
        evidence.append("\n".join(lines))
    for project in library.projects:
        lines = [f"Project: {project.name}"]
        if dates := format_date_range(project.start_date, project.end_date):
            lines.append(f"Dates: {dates}")
        if project.role and project.role.strip():
            lines.append(f"Role: {project.role}")
        if project.description and project.description.strip():
            lines.append(f"Description: {project.description}")
        evidence.append("\n".join(lines))
    for education in library.educations:
        lines = [f"Education: {education.institution}"]
        if dates := format_date_range(education.start_date, education.end_date):
            lines.append(f"Dates: {dates}")
        for label, value in (("Degree", education.degree), ("Field", education.field_of_study),
                             ("Description", education.description)):
            if value and value.strip():
                lines.append(f"{label}: {value}")
        evidence.append("\n".join(lines))
    for certificate in library.certifications:
        lines = [f"Certification: {certificate.name}"]
        for label, value in (("Issuer", certificate.issuer), ("Description", certificate.description)):
            if value and value.strip():
                lines.append(f"{label}: {value}")
        if certificate.issued_date:
            lines.append(f"Issued: {format_certification_date(certificate.issued_date, certificate.issued_date_precision)}")
        if certificate.expiry_date:
            lines.append(f"Expires: {format_certification_date(certificate.expiry_date, certificate.expiry_date_precision)}")
        for label, value in (("Credential ID", certificate.credential_id),
                             ("Credential URL", certificate.credential_url)):
            if value and value.strip():
                lines.append(f"{label}: {value}")
        evidence.append("\n".join(lines))
    for skill in library.skills:
        evidence.append(f"Skill: {skill.name}" + (f" ({skill.category})" if skill.category and skill.category.strip() else ""))
    evidence.extend(f"Career fact: {fact.response}" for fact in library.facts if fact.response.strip())
    return "\n\n".join(evidence) if evidence else "None provided."
