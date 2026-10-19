"""Label library evidence, gap responses, and selected resume snapshots.

Prompts and claim checks share stable labels even when retrieval narrows the library.
Selected section records supply generated/copied draft snapshots to later writers.
Saved evidence keeps its rendered field selection alongside its screening provenance.
"""

from dataclasses import dataclass, field

from schemas.certification_dates import format_certification_date
from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext, LibraryRecord


@dataclass
class SourceProvenance:
    """The saved records and field selection used to render one source.

    Screening owns approval decisions; this describes only where the text came from.
    """

    library: CareerLibrary = field(default_factory=CareerLibrary)
    used_fields: dict[str, set[str]] = field(default_factory=dict)

    def select(self, collection: str, record_type: str, record: LibraryRecord, *names: str) -> dict:
        """Capture saved identity/checks and return the values the formatter will use."""
        values = {name: getattr(record, name) for name in names}
        snapshot = record.model_copy(update={"highlights": []}) if collection == "experiences" else record.model_copy()
        owner = self.library.experiences[0] if collection == "highlights" else self.library
        getattr(owner, collection).append(snapshot)
        self.used_fields[record_type] = set(values)
        return values


@dataclass(frozen=True)
class SourceRecord:
    """One thing the model may cite."""

    label: str
    kind: str
    text: str
    record_id: str | None = None
    source_type: str | None = None
    provenance: SourceProvenance | None = field(default=None, repr=False, compare=False)


@dataclass
class LabeledSources:
    """Stable labels and evidence for one section prompt."""

    records: dict[str, SourceRecord] = field(default_factory=dict)

    def text_for(self, labels: list[str]) -> str:
        """Joins the text of the labels that exist."""
        return "\n".join(self.records[label].text for label in labels if label in self.records)


# A section's own rows. Retrieval ranks experience; it must not hide a degree or a skill
# because a job's requirements sit closer to work highlights.
_NATIVE_TYPES = {
    "projects": frozenset({"Project"}),
    "certifications": frozenset({"Certification"}),
    "education": frozenset({"Education"}),
    "skills": frozenset({"Skill"}),
}


def label_sources(
    context: GapAnalysisContext,
    gap_responses: list[dict[str, str]],
    selected_sections: list[dict[str, object]],
    retrieved: set[tuple[str, str]] | None,
    section_type: str = "",
) -> LabeledSources:
    """Label library evidence plus gap responses and selected draft snapshots.
    Selected snapshots are included independently of retrieval. The section's own entry type is included
    even when retrieval returned other rows."""
    sources = LabeledSources()
    native = _NATIVE_TYPES.get(section_type, frozenset())
    _add_library(sources, context.career_library, retrieved, native)
    for number, response in enumerate(gap_responses, start=1):
        text = f"{response.get('requirement', '')}: {response.get('body', '')}"
        sources.records[f"GR{number}"] = SourceRecord(f"GR{number}", "gap_response", text)
    for number, section in enumerate(selected_sections, start=1):
        if section.get("omitted"):
            continue
        title = str(section.get("title") or section.get("section_type"))
        text = _flatten(section.get("content"))
        sources.records[f"A{number}"] = SourceRecord(f"A{number}", "selected_section", f"{title}: {text}")
    return sources


def _add_library(
    sources: LabeledSources,
    library: CareerLibrary,
    retrieved: set[tuple[str, str]] | None,
    native: frozenset[str],
) -> None:
    """Labels library entries, dropping ones retrieval did not return."""
    if library.summary:
        provenance = SourceProvenance(
            CareerLibrary(summary=library.summary, summary_record_id=library.summary_record_id,
                          screened_fields=list(library.screened_fields)),
            {"user": {"summary"}},
        )
        sources.records["SUMMARY"] = SourceRecord("SUMMARY", "summary", provenance.library.summary,
                                                  provenance=provenance)
    highlight_number = 0
    for number, experience in enumerate(library.experiences, start=1):
        highlight_labels = []
        for highlight in experience.highlights:
            highlight_number += 1
            highlight_labels.append((highlight_number, highlight))
        experience_kept = _keep(retrieved, "Experience", experience.id, native) or any(
            _keep(retrieved, "ExperienceHighlight", highlight.id, native)
            for _, highlight in highlight_labels
        )
        if experience_kept:
            provenance = SourceProvenance()
            values = provenance.select("experiences", "experience", experience, "title", "company", "description")
            role = f"{values['title']} at {values['company']}"
            text = role if not values["description"] else f"{role}: {values['description']}"
            sources.records[f"E{number}"] = SourceRecord(
                f"E{number}", "experience", text, experience.id, "Experience", provenance
            )
        for highlight_number_value, highlight in highlight_labels:
            if experience_kept or _keep(retrieved, "ExperienceHighlight", highlight.id, native):
                provenance = SourceProvenance()
                values = provenance.select("experiences", "experience", experience, "title", "company")
                role = f"{values['title']} at {values['company']}"
                values = provenance.select("highlights", "experience_highlight", highlight, "content")
                sources.records[f"H{highlight_number_value}"] = SourceRecord(
                    f"H{highlight_number_value}",
                    "highlight",
                    f"{role}: {values['content']}",
                    highlight.id,
                    "ExperienceHighlight",
                    provenance,
                )
    _add_simple(sources, library, retrieved, native)


def _add_simple(
    sources: LabeledSources,
    library: CareerLibrary,
    retrieved: set[tuple[str, str]] | None,
    native: frozenset[str],
) -> None:
    """Labels projects, education, certifications, skills, and library facts."""
    for number, project in enumerate(library.projects, start=1):
        if _keep(retrieved, "Project", project.id, native):
            provenance = SourceProvenance()
            values = provenance.select("projects", "project", project, "name", "description")
            text = values["name"] if not values["description"] else f"{values['name']}: {values['description']}"
            sources.records[f"P{number}"] = SourceRecord(f"P{number}", "project", text, project.id, "Project", provenance)
    for number, education in enumerate(library.educations, start=1):
        if _keep(retrieved, "Education", education.id, native):
            provenance = SourceProvenance()
            values = provenance.select("educations", "education", education, "degree", "field_of_study", "institution")
            text = ", ".join(part for part in values.values() if part)
            sources.records[f"ED{number}"] = SourceRecord(
                f"ED{number}", "education", text, education.id, "Education", provenance
            )
    for number, certification in enumerate(library.certifications, start=1):
        if _keep(retrieved, "Certification", certification.id, native):
            provenance = SourceProvenance()
            values = provenance.select("certifications", "certification", certification,
                                       "name", "issuer", "credential_id", "credential_url", "description")
            text = ", ".join(str(part) for part in (
                values["name"], values["issuer"],
                f"issued {format_certification_date(certification.issued_date, certification.issued_date_precision)}" if certification.issued_date else None,
                f"expires {format_certification_date(certification.expiry_date, certification.expiry_date_precision)}" if certification.expiry_date else None,
                values["credential_id"], values["credential_url"], values["description"],
            ) if part)
            sources.records[f"C{number}"] = SourceRecord(
                f"C{number}", "certification", text, certification.id, "Certification", provenance
            )
    for number, skill in enumerate(library.skills, start=1):
        if _keep(retrieved, "Skill", skill.id, native):
            provenance = SourceProvenance()
            values = provenance.select("skills", "skill", skill, "name")
            sources.records[f"S{number}"] = SourceRecord(
                f"S{number}", "skill", values["name"], skill.id, "Skill", provenance)
    for number, fact in enumerate(library.facts, start=1):
        if _keep(retrieved, "LibraryFact", fact.id, native):
            provenance = SourceProvenance()
            values = provenance.select("facts", "library_fact", fact, "requirement", "response")
            sources.records[f"F{number}"] = SourceRecord(
                f"F{number}", "fact", f"{values['requirement']}: {values['response']}", fact.id, "LibraryFact", provenance
            )


def _keep(
    retrieved: set[tuple[str, str]] | None, source_type: str, record_id: str | None, native: frozenset[str]
) -> bool:
    """True for a section's own rows, when retrieval didn't narrow the library, or when this
    row was retrieved."""
    if source_type in native and record_id is not None:
        return True
    if retrieved is None or record_id is None:
        return retrieved is None
    return (source_type, record_id) in retrieved


def _flatten(content: object) -> str:
    """The readable text of a section snapshot."""
    parts: list[str] = []

    def walk(value: object) -> None:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(content)
    return "\n".join(parts)
