"""Turn a screened career library into readable labeled sections for a model.

Callers read, select and screen the entries first. Each returned section covers one
entry, so callers can stop at a size cap without cutting an entry in half. Saved
record IDs and screening metadata never appear in the text.
"""
from model_inputs.blocks import source_block
from schemas.gap_analysis_context import CareerLibrary


def render_career_library_sections(library: CareerLibrary) -> list[str]:
    """Return one readable section per entry, in saved library order."""
    sections = []
    if library.summary and library.summary.strip():
        sections.append("## Profile summary\n" + source_block("career_entry", library.summary))
    for experience in library.experiences:
        lines = [f"Title: {experience.title}", f"Company: {experience.company}"]
        _add(lines, "Location", experience.location)
        _add(lines, "Dates", _dates(experience.start_date, experience.end_date))
        _add(lines, "Description", experience.description)
        lines += [f"- {highlight.content}" for highlight in experience.highlights]
        sections.append(_section("Experience", lines))
    for project in library.projects:
        lines = [f"Name: {project.name}"]
        _add(lines, "Role", project.role)
        _add(lines, "Dates", _dates(project.start_date, project.end_date))
        _add(lines, "Description", project.description)
        sections.append(_section("Project", lines))
    for education in library.educations:
        lines = [f"Institution: {education.institution}"]
        _add(lines, "Degree", education.degree)
        _add(lines, "Field of study", education.field_of_study)
        _add(lines, "Dates", _dates(education.start_date, education.end_date))
        _add(lines, "Description", education.description)
        sections.append(_section("Education", lines))
    for certification in library.certifications:
        lines = [f"Name: {certification.name}"]
        _add(lines, "Issuer", certification.issuer)
        _add(lines, "Issued", certification.issued_date and certification.issued_date.isoformat())
        _add(lines, "Expires", certification.expiry_date and certification.expiry_date.isoformat())
        _add(lines, "Description", certification.description)
        sections.append(_section("Certification", lines))
    if library.skills:
        lines = [f"- {skill.name}" + (f" ({skill.category})" if skill.category else "") for skill in library.skills]
        sections.append(_section("Skills", lines))
    for context in library.career_contexts:
        lines = []
        _add(lines, "Requirement", context.requirement)
        _add(lines, "User's answer", context.response)
        sections.append(_section("Career context", lines))
    return sections


def _section(heading, lines):
    return f"## {heading}\n" + source_block("career_entry", "\n".join(lines))


def _add(lines, label, value):
    if value and str(value).strip():
        lines.append(f"{label}: {value}")


def _dates(start, end):
    if not start and not end:
        return None
    return f"{start.isoformat() if start else 'unknown'} to {end.isoformat() if end else 'present'}"
