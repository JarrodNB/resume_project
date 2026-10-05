"""
Description: Labels the library, screened gap responses, and approved sections the way the
tailoring prompt and the faithfulness checker refer to them.
Index:
    - SourceRecord: one labeled source and the text a claim must appear in
    - LabeledSources: the label map for one section
    - label_sources: builds that map, optionally limited to retrieved library ids
"""

from dataclasses import dataclass, field

from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext


@dataclass(frozen=True)
class SourceRecord:
    """One thing the model may cite."""

    label: str
    kind: str
    text: str
    record_id: str | None = None
    source_type: str | None = None


@dataclass
class LabeledSources:
    """Labels for one section prompt. `library_ids` is (Rails class name, id) for retrieval."""

    records: dict[str, SourceRecord] = field(default_factory=dict)

    def text_for(self, labels: list[str]) -> str:
        """Joins the text of the labels that exist."""
        return "\n".join(self.records[label].text for label in labels if label in self.records)


def label_sources(
    context: GapAnalysisContext,
    gap_responses: list[dict[str, str]],
    approved_sections: list[dict[str, object]],
    retrieved: set[tuple[str, str]] | None,
) -> LabeledSources:
    """Labels the library (all of it when `retrieved` is None) plus gap responses and
    approved sections, which are always included."""
    sources = LabeledSources()
    _add_library(sources, context.career_library, retrieved)
    for number, response in enumerate(gap_responses, start=1):
        text = f"{response.get('requirement', '')}: {response.get('body', '')}"
        sources.records[f"GR{number}"] = SourceRecord(f"GR{number}", "gap_response", text)
    for number, section in enumerate(approved_sections, start=1):
        if section.get("omitted"):
            continue
        title = str(section.get("title") or section.get("section_type"))
        text = _flatten(section.get("content"))
        sources.records[f"A{number}"] = SourceRecord(f"A{number}", "approved", f"{title}: {text}")
    return sources


def _add_library(
    sources: LabeledSources, library: CareerLibrary, retrieved: set[tuple[str, str]] | None
) -> None:
    """Labels library entries, dropping ones retrieval did not return."""
    if library.summary:
        sources.records["SUMMARY"] = SourceRecord("SUMMARY", "summary", library.summary)
    highlight_number = 0
    for number, experience in enumerate(library.experiences, start=1):
        role = f"{experience.title} at {experience.company}"
        highlight_labels: list[tuple[int, str, str]] = []
        for highlight in experience.highlights:
            highlight_number += 1
            highlight_labels.append((highlight_number, highlight.id, highlight.content))
        experience_kept = _keep(retrieved, "Experience", experience.id) or any(
            _keep(retrieved, "ExperienceHighlight", highlight_id)
            for _, highlight_id, _ in highlight_labels
        )
        if experience_kept:
            text = role if not experience.description else f"{role}: {experience.description}"
            sources.records[f"E{number}"] = SourceRecord(
                f"E{number}", "experience", text, experience.id, "Experience"
            )
        for highlight_number_value, highlight_id, content in highlight_labels:
            if experience_kept or _keep(retrieved, "ExperienceHighlight", highlight_id):
                sources.records[f"H{highlight_number_value}"] = SourceRecord(
                    f"H{highlight_number_value}",
                    "highlight",
                    f"{role}: {content}",
                    highlight_id,
                    "ExperienceHighlight",
                )
    _add_simple(sources, library, retrieved)


def _add_simple(
    sources: LabeledSources, library: CareerLibrary, retrieved: set[tuple[str, str]] | None
) -> None:
    """Labels projects, education, skills, and library facts."""
    for number, project in enumerate(library.projects, start=1):
        if _keep(retrieved, "Project", project.id):
            text = project.name if not project.description else f"{project.name}: {project.description}"
            sources.records[f"P{number}"] = SourceRecord(f"P{number}", "project", text, project.id, "Project")
    for number, education in enumerate(library.educations, start=1):
        if _keep(retrieved, "Education", education.id):
            text = ", ".join(part for part in (education.degree, education.field_of_study, education.institution) if part)
            sources.records[f"ED{number}"] = SourceRecord(
                f"ED{number}", "education", text, education.id, "Education"
            )
    for number, skill in enumerate(library.skills, start=1):
        if _keep(retrieved, "Skill", skill.id):
            sources.records[f"S{number}"] = SourceRecord(f"S{number}", "skill", skill.name, skill.id, "Skill")
    for number, fact in enumerate(library.facts, start=1):
        if _keep(retrieved, "LibraryFact", fact.id):
            sources.records[f"F{number}"] = SourceRecord(
                f"F{number}", "fact", f"{fact.requirement}: {fact.response}", fact.id, "LibraryFact"
            )


def _keep(retrieved: set[tuple[str, str]] | None, source_type: str, record_id: str | None) -> bool:
    """True when retrieval didn't narrow the library, or this row was retrieved."""
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
