"""Assemble editable resume snapshots using saved library identity.

Written sections keep the model's checked prose. Education and certifications have an
exact copy path that preserves their original descriptions and credential date precision.
"""

from datetime import date

from schemas.certification_dates import format_certification_date
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


def copy_library_section(section_type: str, library: CareerLibrary, sources: LabeledSources) -> dict[str, object]:
    """Copy all degrees or credentials with their original descriptions and date precision.

    These display-only snapshots are not generated prose. If reused in a later prompt,
    the caller must screen them just like other saved user text.
    """
    if section_type == "education":
        rows, kind, build = library.educations, "education", _education_item
    elif section_type == "certifications":
        rows, kind, build = library.certifications, "certification", _certification_item
    else:
        raise ValueError("Only education and certifications are copied library sections")
    descriptions = {row.id: row.description for row in rows}
    items = []
    for label, record in sources.records.items():
        if record.kind == kind:
            item = build(label, [], library, sources)
            item["description"] = descriptions[record.record_id]
            items.append(item)
    return {"items": items}


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
    roles = [{
        "id": role.id, "title": role.title,
        "start_date": _month(role.start_date), "end_date": _month(role.end_date),
        "is_current": role.start_date is not None and role.end_date is None,
        "description": role.description, "highlights": [], "highlight_source_ids": [],
    } for role in experience.roles]
    shared, shared_ids = [], []
    for item in prose:
        evidence = [sources.records[label] for label in item.source_labels if label in sources.records]
        highlights = [source for source in evidence if source.kind == "highlight"]
        scopes = {source.experience_role_id for source in highlights}
        scope = next(iter(scopes)) if len(scopes) == 1 else None
        # The same entry label is identity context; temporary/fact evidence has no role attribution.
        if any(source.kind not in {"highlight", "experience"} for source in evidence):
            scope = None
        owner = next((role for role in roles if scope is not None and role["id"] == scope), None)
        ids = [source.record_id for source in highlights if source.experience_id == experience.id]
        (owner["highlights"] if owner else shared).append(item.text)
        (owner["highlight_source_ids"] if owner else shared_ids).append(ids)
    return {
        "source_experience_id": experience.id,
        "company": experience.company, "location": experience.location,
        "roles": roles, "description": experience.description,
        "highlights": shared, "highlight_source_ids": shared_ids,
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
        "issued_date": format_certification_date(certification.issued_date, certification.issued_date_precision),
        "expiry_date": format_certification_date(certification.expiry_date, certification.expiry_date_precision),
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
