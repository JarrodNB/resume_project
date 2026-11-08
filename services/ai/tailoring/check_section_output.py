"""Check whether a model-written section can become an editable resume section.

Section shape, supplied labels, and complete work history are checked here. The model writes the prose;
the user reviews and edits it before saving. A narrow writing check also catches text that was never
meant for the page, such as a note about sources. It does not judge whether a claim is true.
"""

import re

from schemas.tailored_section import CitedProse, TailoredSectionDraft
from tailoring.labeled_sources import LabeledSources
from tailoring.section_catalog import ENTRY_PREFIX

# Kept narrow on purpose: a false match costs a paid retry, and real bullets can say almost anything.
_NOTE_TO_READER = re.compile(
    r"\b(?:(?:listed|provided|supplied) sources?|source labels?|career_source|not supported by the)\b", re.IGNORECASE)
_STATED_LACK = re.compile(
    r"\b(?:ha(?:s|ve) not (?:used|worked|held|managed|led)|does not have|"
    r"(?:no|lacks?) (?:direct |formal |hands-on |prior |professional )?experience (?:with|in))\b", re.IGNORECASE)


def find_section_problems(
    section_type: str, draft: TailoredSectionDraft, sources: LabeledSources
) -> list[str]:
    """List unusable structure or unknown labels that require a repair response."""
    coverage_problems = _experience_coverage_problems(draft, sources) if section_type == "experience" else []
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


def _experience_coverage_problems(
    draft: TailoredSectionDraft, sources: LabeledSources
) -> list[str]:
    """Require every supplied role exactly once, retaining the source order in repair notes."""
    labels = [entry.label for entry in draft.entries]
    included_labels = set(labels)
    missing = [
        label for label, record in sources.records.items()
        if record.kind == "experience" and label not in included_labels
    ]
    problems = []
    if missing:
        problems.append(
            "Include every experience entry; missing labels: " + ", ".join(missing)
            + ". Shorten less relevant roles rather than removing them. Set nothing_fits to false."
        )
    if len(labels) != len(included_labels):
        problems.append("Include each experience entry exactly once.")
    return problems


def find_writing_problems(draft: TailoredSectionDraft) -> list[str]:
    """List prose that should never reach a resume. Unlike shape problems, this is worth one retry but never a failure."""
    prose = [*([draft.summary] if draft.summary else []), *(item for entry in draft.entries for item in entry.prose)]
    problems = []
    for item in prose:
        if _NOTE_TO_READER.search(item.text):
            problems.append(f"Remove the note about sources; the page holds only resume content: {item.text}")
        if _STATED_LACK.search(item.text):
            problems.append(f"Do not state what the person lacks. Leave it out: {item.text}")
    return problems


def _unknown_source_labels(prose: CitedProse, sources: LabeledSources) -> list[str]:
    unknown = [label for label in prose.source_labels if label not in sources.records]
    return [f"Unknown source labels: {', '.join(unknown)}."] if unknown else []
