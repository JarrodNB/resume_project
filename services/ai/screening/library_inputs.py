"""Select safe career-library entries and rebuild them from their checked source text.

Each entry is one optional input, including its descriptive fields and highlights. The
returned layout contains only application-owned field names, so prompt builders can
reconstruct a library from checked source values. Saved field approvals are reused;
unchecked fields are checked together for each optional entry before it is retained.
"""

import json
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from schemas.gap_analysis_context import CareerLibrary
from screening.library_fields import screen_library_fields, screen_library_fields_async
from text_limits import MAX_SCREENED_TEXT, NOTE_TOO_LONG_WARNING

LIBRARY_INPUT_OMITTED_WARNING = "One of your career library entries was left out."
_ENTRY_FIELDS = ("experiences", "projects", "educations", "certifications", "skills", "career_contexts")


@dataclass(frozen=True)
class ScreenedLibrary:
    """Retained prompt inputs and their structural layout, excluding saved metadata."""

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
            if field == "career_contexts":
                item.setdefault("requirement", "")
            content[field].append(item)
        else:
            raise ValueError("Unknown library input field")
    return CareerLibrary.model_validate(content)


def screen_library_inputs(
    library: CareerLibrary, allow_text: Callable[[str], object], *,
    include_context_requirements: bool = True,
) -> ScreenedLibrary:
    """Omit rejected optional entries and retain exact strings for prompt coverage binding."""
    selection = _Selection()
    for field, text, snapshot in _library_entries(library, include_context_requirements):
        if len(text) > MAX_SCREENED_TEXT:
            selection.too_long = True
            continue
        selection.add(field, text, screen_library_fields(
            snapshot, allow_text, include_context_requirements=include_context_requirements,
            approved_sources=(text,),
        ))
    return selection.finish()


async def screen_library_inputs_async(
    library: CareerLibrary, allow_text: Callable[[str], Awaitable[object]], *,
    include_context_requirements: bool = True,
) -> ScreenedLibrary:
    """Apply the same entry selection without blocking an asynchronous caller's event loop."""
    selection = _Selection()
    for field, text, snapshot in _library_entries(library, include_context_requirements):
        if len(text) > MAX_SCREENED_TEXT:
            selection.too_long = True
            continue
        selection.add(field, text, await screen_library_fields_async(
            snapshot, allow_text, include_context_requirements=include_context_requirements,
            approved_sources=(text,),
        ))
    return selection.finish()


def _library_entries(library: CareerLibrary, include_context_requirements: bool):
    """Yield each optional entry's exact source text with a one-entry snapshot for its checks."""
    if library.summary and library.summary.strip():
        yield "summary", library.summary, CareerLibrary(
            summary=library.summary, summary_record_id=library.summary_record_id,
            screened_fields=library.screened_fields,
        )
    for field in _ENTRY_FIELDS:
        for entry in getattr(library, field):
            exclude = {"requirement"} if field == "career_contexts" and not include_context_requirements else None
            yield (field, entry.model_dump_json(exclude_none=True, exclude=exclude),
                   CareerLibrary(**{field: [entry]}))


class _Selection:
    """Collect allowed entries and the warnings for anything left out."""

    def __init__(self):
        self.sources, self.fields = [], []
        self.omitted = self.too_long = False

    def add(self, field, text, decision):
        allowed = decision if isinstance(decision, bool) else getattr(decision, "allowed", False)
        if allowed:
            self.sources.append(text)
            self.fields.append(field)
        elif getattr(decision, "too_long", False):
            self.too_long = True
        else:
            self.omitted = True

    def finish(self) -> ScreenedLibrary:
        warnings = []
        if self.omitted:
            warnings.append(LIBRARY_INPUT_OMITTED_WARNING)
        if self.too_long:
            warnings.append(NOTE_TOO_LONG_WARNING)
        return ScreenedLibrary(tuple(self.sources), tuple(self.fields), tuple(warnings))
