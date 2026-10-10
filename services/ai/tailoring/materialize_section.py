"""
Description: Turns a checked TailoredSectionDraft into the JSON snapshot a resume section
stores. Identity fields are copied from the library label; prose is the model's wording and
is not replaced with the original library text.
Index:
    - materialize_section: the content object for one section type
"""

from datetime import date

from schemas.gap_analysis_context import (
    CareerLibrary,
    LibraryCertification,
    LibraryEducation,
    LibraryExperience,
    LibraryProject,
    LibrarySkill,
)
from schemas.tailored_section import TailoredSectionDraft
from tailoring.labeled_sources import LabeledSources


def materialize_section(
    section_type: str, draft: TailoredSectionDraft, library: CareerLibrary, sources: LabeledSources
) -> dict[str, object]:
    """The section content the page edits. An omitted-by-the-model section is empty."""
    if draft.nothing_fits:
        return {"text": ""} if section_type == "summary" else {"items": []}
    if section_type == "summary":
        return {"text": draft.summary.text if draft.summary else ""}
    if section_type == "skills":
        return {"items": [_skill_item(entry.label, library, sources) for entry in draft.entries]}
    if section_type == "experience":
        return {"items": [_experience_item(entry.label, entry.prose, library, sources) for entry in draft.entries]}
    if section_type == "certifications":
        return {"items": [_certification_item(entry.label, entry.prose, library, sources) for entry in draft.entries]}
    if section_type == "projects":
        return {"items": [_project_item(entry.label, entry.prose, library, sources) for entry in draft.entries]}
    return {"items": [_education_item(entry.label, entry.prose, library, sources) for entry in draft.entries]}


def _month(value: date | None) -> str | None:
    """A partial date, matching the resume review fields."""
    return value.strftime("%Y-%m") if value else None


def _skill_item(label: str, library: CareerLibrary, sources: LabeledSources) -> dict[str, object]:
    """Name and category copied from the skill the label names."""
    skill = _find(library.skills, sources, label)
    assert isinstance(skill, LibrarySkill)
    return {"name": skill.name, "category": skill.category}


def _experience_item(label: str, prose: list, library: CareerLibrary, sources: LabeledSources) -> dict[str, object]:
    """The role's identity from the library, and the model's bullets."""
    experience = _find(library.experiences, sources, label)
    assert isinstance(experience, LibraryExperience)
    return {
        "company": experience.company,
        "title": experience.title,
        "location": experience.location,
        "start_date": _month(experience.start_date),
        "end_date": _month(experience.end_date),
        "is_current": experience.end_date is None and experience.start_date is not None,
        "description": None,
        "highlights": [item.text for item in prose],
    }


def _project_item(label: str, prose: list, library: CareerLibrary, sources: LabeledSources) -> dict[str, object]:
    """The project's name and role from the library, and the model's description."""
    project = _find(library.projects, sources, label)
    assert isinstance(project, LibraryProject)
    description = "\n".join(item.text for item in prose) or None
    return {
        "name": project.name,
        "role": project.role,
        "url": None,
        "start_date": _month(project.start_date),
        "end_date": _month(project.end_date),
        "description": description,
    }


def _education_item(label: str, prose: list, library: CareerLibrary, sources: LabeledSources) -> dict[str, object]:
    """The degree's identity from the library, and the model's description."""
    education = _find(library.educations, sources, label)
    assert isinstance(education, LibraryEducation)
    description = "\n".join(item.text for item in prose) or None
    return {
        "institution": education.institution,
        "degree": education.degree,
        "field_of_study": education.field_of_study,
        "start_date": _month(education.start_date),
        "end_date": _month(education.end_date),
        "description": description,
    }


def _certification_item(label: str, prose: list, library: CareerLibrary, sources: LabeledSources) -> dict[str, object]:
    """Copies certification identity and dates; keeps only checked description prose."""
    certification = _find(library.certifications, sources, label)
    assert isinstance(certification, LibraryCertification)
    return {
        "name": certification.name,
        "issuer": certification.issuer,
        "issued_date": _month(certification.issued_date),
        "expiry_date": _month(certification.expiry_date),
        "credential_id": certification.credential_id,
        "credential_url": certification.credential_url,
        "description": "\n".join(item.text for item in prose) or None,
    }


def _find(records: list, sources: LabeledSources, label: str) -> object:
    """The library row a label points at."""
    record_id = sources.records[label].record_id
    for record in records:
        if record.id == record_id:
            return record
    raise KeyError(label)
