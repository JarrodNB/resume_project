"""Check a bounded career library as one input and rebuild its approved source text.

The complete input includes descriptive fields and highlights. The
returned layout contains only application-owned field names, so prompt builders can
reconstruct a library from checked source values. Saved field approvals are reused;
unchecked fields are checked together. Failed checks never yield a partial library.
"""

import json
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from schemas.gap_analysis_context import MAX_LIBRARY_ITEMS, CareerLibrary
from screening.library_fields import screen_library_fields, screen_library_fields_async
from text_limits import MAX_SCREENED_TEXT

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
    """Check all pending fields together and retain exact strings for prompt coverage binding."""
    entries = _bounded_entries(library, include_context_requirements)
    decision = screen_library_fields(library, allow_text,
        include_context_requirements=include_context_requirements,
        approved_sources=tuple(text for _, text in entries))
    return _checked_entries(entries, decision)


async def screen_library_inputs_async(
    library: CareerLibrary, allow_text: Callable[[str], Awaitable[object]], *,
    include_context_requirements: bool = True,
) -> ScreenedLibrary:
    """Check the bounded library together; a rejected check fails the entire operation."""
    entries = _bounded_entries(library, include_context_requirements)
    decision = await screen_library_fields_async(library, allow_text,
        include_context_requirements=include_context_requirements,
        approved_sources=tuple(text for _, text in entries))
    return _checked_entries(entries, decision)


class LibraryScreeningError(RuntimeError):
    """A library cannot be shared in full within its safety and size limits."""


def _bounded_entries(library, include_context_requirements):
    entries = list(_library_entries(library, include_context_requirements))
    item_count = len(entries) + sum(len(role.highlights) for role in library.experiences)
    if item_count > MAX_LIBRARY_ITEMS or sum(len(text) for _, text in entries) > MAX_SCREENED_TEXT:
        raise LibraryScreeningError("context_limit")
    return entries


def _checked_entries(entries, decision):
    allowed = decision if isinstance(decision, bool) else getattr(decision, "allowed", False)
    if not allowed:
        raise LibraryScreeningError("context_limit" if getattr(decision, "too_long", False) else
            "screening_unavailable" if getattr(decision, "unchecked", False) else "screening_blocked")
    return ScreenedLibrary(tuple(text for _, text in entries), tuple(field for field, _ in entries), ())


def _library_entries(library: CareerLibrary, include_context_requirements: bool):
    """Yield each entry's exact source text for reconstruction and coverage binding."""
    if library.summary and library.summary.strip():
        yield "summary", library.summary
    for field in _ENTRY_FIELDS:
        for entry in getattr(library, field):
            exclude = {"requirement"} if field == "career_contexts" and not include_context_requirements else None
            yield field, entry.model_dump_json(exclude_none=True, exclude=exclude)
