"""Check whether a model-written section can become an editable resume section.

Section shape, supplied labels, and complete work history are checked here. The model writes the prose;
the user reviews and edits it before saving.
"""

from schemas.tailored_section import CitedProse, TailoredSectionDraft
from tailoring.labeled_sources import LabeledSources
from tailoring.section_catalog import ENTRY_PREFIX


def find_section_problems(
    section_type: str, draft: TailoredSectionDraft, sources: LabeledSources
) -> list[str]:
    """List unusable structure or unknown labels that require a repair response."""
    coverage_problems = []
    if section_type == "experience":
        required = [label for label, record in sources.records.items() if record.kind == "experience"]
        missing = [label for label in required if label not in {entry.label for entry in draft.entries}]
        if missing:
            coverage_problems.append("Include every experience entry; missing labels: " + ", ".join(missing)
                    + ". Shorten less relevant roles rather than removing them. Set nothing_fits to false.")
        labels = [entry.label for entry in draft.entries]
        if len(labels) != len(set(labels)):
            coverage_problems.append("Include each experience entry exactly once.")
    if draft.nothing_fits:
        if draft.entries or draft.summary:
            return ["nothing_fits is true, so entries and summary must be empty."]
        return coverage_problems
    if section_type == "summary":
        problems = []
        if draft.summary is None or not draft.summary.text.strip():
            problems.append("Write the summary paragraph, or set nothing_fits to true.")
        if draft.entries:
            problems.append("The summary section does not include entries.")
        if draft.summary is not None:
            problems.extend(_unknown_source_labels(draft.summary, sources))
        return problems

    problems = []
    if draft.summary is not None:
        problems.append("Only the summary section includes a summary paragraph.")
    if not draft.entries:
        problems.append("Include at least one entry, or set nothing_fits to true.")
    prefix = ENTRY_PREFIX[section_type]
    for entry in draft.entries:
        record = sources.records.get(entry.label)
        if (not entry.label.startswith(prefix) or record is None
                or record.kind != section_type.removesuffix("s")):
            problems.append(f"Unknown {section_type} label: {entry.label}.")
        for prose in entry.prose:
            problems.extend(_unknown_source_labels(prose, sources))
    return problems + coverage_problems


def _unknown_source_labels(prose: CitedProse, sources: LabeledSources) -> list[str]:
    unknown = [label for label in prose.source_labels if label not in sources.records]
    return [f"Unknown source labels: {', '.join(unknown)}."] if unknown else []
