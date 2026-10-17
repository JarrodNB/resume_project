"""Select safe career-library entries and rebuild them from their checked source text.

Each entry is one optional input, including its descriptive fields and highlights. The
returned layout contains only application-owned field names, so prompt builders can
reconstruct a library exclusively from the source values approved in this execution.
"""

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from schemas.gap_analysis_context import CareerLibrary
from text_limits import NOTE_TOO_LONG_WARNING

LIBRARY_INPUT_OMITTED_WARNING = "One of your career library entries was left out."
_ENTRY_FIELDS = ("experiences", "projects", "educations", "certifications", "skills", "facts")


@dataclass(frozen=True)
class ScreenedLibrary:
    """Retained inputs and their structural layout, with no approval token to persist."""

    sources: tuple[str, ...]
    fields: tuple[str, ...]
    warnings: tuple[str, ...]

    @property
    def library(self) -> CareerLibrary:
        """Return a fresh domain object containing only retained entries."""
        return rebuild_library(self.sources, self.fields)


def rebuild_library(sources: Sequence[str], fields: Sequence[str]) -> CareerLibrary:
    """Recreate the library from supplied source values and fixed structural field names."""
    if len(sources) != len(fields):
        raise ValueError("Library source layout does not match its values")
    content = {field: [] for field in _ENTRY_FIELDS}
    for source, field in zip(sources, fields):
        if field == "summary":
            content["summary"] = source
        elif field in _ENTRY_FIELDS:
            item = json.loads(source)
            if field == "facts":
                item.setdefault("requirement", "")
            content[field].append(item)
        else:
            raise ValueError("Unknown library input field")
    return CareerLibrary.model_validate(content)


def screen_library_inputs(
    library: CareerLibrary, allow_text: Callable[[str], object], *,
    include_fact_requirements: bool = True,
) -> ScreenedLibrary:
    """Omit rejected optional entries and retain exact strings for prompt coverage binding."""
    sources = []
    fields = []
    omitted = too_long = False

    def keep(field, text):
        nonlocal omitted, too_long
        decision = allow_text(text)
        allowed = decision if isinstance(decision, bool) else getattr(decision, "allowed", False)
        if allowed:
            sources.append(text)
            fields.append(field)
        elif getattr(decision, "too_long", False):
            too_long = True
        else:
            omitted = True

    if library.summary and library.summary.strip():
        keep("summary", library.summary)
    for field in _ENTRY_FIELDS:
        for entry in getattr(library, field):
            exclude = {"requirement"} if field == "facts" and not include_fact_requirements else None
            keep(field, entry.model_dump_json(exclude_none=True, exclude=exclude))
    warnings = []
    if omitted:
        warnings.append(LIBRARY_INPUT_OMITTED_WARNING)
    if too_long:
        warnings.append(NOTE_TOO_LONG_WARNING)
    return ScreenedLibrary(tuple(sources), tuple(fields), tuple(warnings))
