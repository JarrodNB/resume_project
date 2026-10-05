"""
Description: Rejects a tailored section that names something none of its cited sources
support. It does not replace the rewrite with the original library text; the agent is
asked to try again.
Index:
    - find_section_problems: problems to send back as a retry, empty when the draft is usable
"""

import re

from documents.text_matching import normalize_text
from schemas.tailored_section import CitedProse, TailoredSectionDraft
from tailoring.labeled_sources import LabeledSources
from tailoring.section_catalog import ENTRY_PREFIX

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?%?")
_TITLE_PHRASE = re.compile(r"\b(?:[A-Z][A-Za-z0-9+#.]* ){1,5}[A-Z][A-Za-z0-9+#.]+\b")
_MARKED_TOKEN = re.compile(r"\b(?:[A-Z]{2,}|[A-Za-z]*\d[A-Za-z0-9+.#-]*)\b")


def find_section_problems(
    section_type: str, draft: TailoredSectionDraft, sources: LabeledSources
) -> list[str]:
    """Lists label and claim problems. An empty list means the draft may be shown."""
    if draft.nothing_fits:
        if draft.entries or draft.summary:
            return ["nothing_fits is true, so entries and summary must be empty."]
        return []
    problems: list[str] = []
    if section_type == "summary":
        problems += _prose_problems(draft.summary, sources, required=True)
        if draft.entries:
            problems.append("The summary section does not include entries.")
        return problems
    prefix = ENTRY_PREFIX[section_type]
    if not draft.entries:
        problems.append("Include at least one entry, or set nothing_fits to true.")
    for entry in draft.entries:
        if not entry.label.startswith(prefix) or entry.label not in sources.records:
            problems.append(f"Unknown {section_type} label: {entry.label}.")
            continue
        haystack = sources.text_for([entry.label])
        for prose in entry.prose:
            problems += _claim_problems(prose, sources, extra_haystack=haystack)
    return problems


def _prose_problems(prose: CitedProse | None, sources: LabeledSources, *, required: bool) -> list[str]:
    """Checks the summary paragraph."""
    if prose is None or not prose.text.strip():
        return ["Write the summary paragraph, or set nothing_fits to true."] if required else []
    return _claim_problems(prose, sources, extra_haystack="")


def _claim_problems(prose: CitedProse, sources: LabeledSources, *, extra_haystack: str) -> list[str]:
    """Unknown labels, and numbers or names that none of the cited sources contain."""
    unknown = [label for label in prose.source_labels if label not in sources.records]
    if unknown:
        return [f"Unknown source labels: {', '.join(unknown)}."]
    if not prose.source_labels:
        return ["Cite the source labels each sentence uses."]
    haystack = normalize_text(extra_haystack + "\n" + sources.text_for(prose.source_labels))
    claims = [*_NUMBER.findall(prose.text), *_TITLE_PHRASE.findall(prose.text), *_MARKED_TOKEN.findall(prose.text)]
    unsupported = [claim for claim in claims if normalize_text(claim).replace(",", "") not in haystack.replace(",", "")]
    if not unsupported:
        return []
    listed = ", ".join(dict.fromkeys(unsupported))
    return [f"These are not in the cited sources, so remove them or cite a source that states them: {listed}."]
