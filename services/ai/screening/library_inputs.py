"""Check a bounded career library as one input and rebuild its approved source text.

The complete input includes descriptive fields and highlights. The returned layout
contains only application-owned field names, so prompt builders can reconstruct a library
from checked source values. Screening goes through `screening.records`: saved field
approvals are reused, unchecked fields are checked together, and new checks become
`record_screening` receipts. Failed checks never yield a partial library.

Usage: the sync variant uses the configured classifier and returns its usage on the
result (or on the error), so callers add it once. The async variant takes the caller's
`screen` function, which records its own usage (chat bills it to the chat operation).
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass

from schemas.gap_analysis_context import MAX_LIBRARY_ITEMS, CareerLibrary
from schemas.model_usage import ModelUsage
from screening.record_adapters import library_records
from screening.records import (
    RecordScreeningOutcome,
    ScreenText,
    screen_records,
    screen_records_sync,
)
from text_limits import MAX_SCREENED_TEXT

LIBRARY_INPUT_OMITTED_WARNING = "One of your career library entries was left out."
_ENTRY_FIELDS = ("experiences", "projects", "educations", "certifications", "skills", "career_contexts")


@dataclass(frozen=True)
class ScreenedLibrary:
    """Retained prompt inputs and their structural layout, excluding saved metadata."""

    sources: tuple[str, ...]
    fields: tuple[str, ...]
    warnings: tuple[str, ...]
    usage: tuple[ModelUsage, ...] = ()

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
    library: CareerLibrary, *, include_context_requirements: bool = True,
) -> ScreenedLibrary:
    """Check all pending fields together with the configured classifier.

    Retains exact strings for prompt coverage binding. Classifier usage is on the result,
    or on the raised `LibraryScreeningError`.
    """
    entries = _bounded_entries(library, include_context_requirements)
    records = library_records(library, include_context_requirements=include_context_requirements)
    outcome = screen_records_sync(records, approved_sources=_sources(entries)) if records else None
    return _checked_entries(entries, outcome, keep_usage=True)


async def screen_library_inputs_async(
    library: CareerLibrary, screen: ScreenText | None = None, *,
    include_context_requirements: bool = True,
) -> ScreenedLibrary:
    """Check the bounded library together; a rejected check fails the entire operation.

    `screen` is passed to `screen_records`, so a caller such as chat can bill screening to
    its own operation. It records its own usage, so the result carries none.
    """
    entries = _bounded_entries(library, include_context_requirements)
    records = library_records(library, include_context_requirements=include_context_requirements)
    outcome = await screen_records(records, approved_sources=_sources(entries), screen=screen) if records else None
    return _checked_entries(entries, outcome, keep_usage=False)


class LibraryScreeningError(RuntimeError):
    """A library cannot be shared in full within its safety and size limits."""

    def __init__(self, code: str, usage: Sequence[ModelUsage] = ()):
        super().__init__(code)
        self.usage = tuple(usage)


def _bounded_entries(library, include_context_requirements):
    entries = list(_library_entries(library, include_context_requirements))
    item_count = len(entries) + sum(len(role.highlights) for role in library.experiences)
    if item_count > MAX_LIBRARY_ITEMS or sum(len(text) for _, text in entries) > MAX_SCREENED_TEXT:
        raise LibraryScreeningError("context_limit")
    return entries


def _sources(entries):
    return tuple(text for _, text in entries)


def _checked_entries(entries, outcome: RecordScreeningOutcome | None, *, keep_usage):
    """Raise for a failed check; otherwise return the layout. No records means nothing to check.

    With no user text there is nothing to approve, so the sources stay uncovered and the
    prompt guard screens whatever reaches the prompt.
    """
    usage = tuple(outcome.decision.model_usages) if outcome is not None and keep_usage else ()
    if outcome is not None and not outcome.allowed:
        decision = outcome.decision
        raise LibraryScreeningError("context_limit" if decision.too_long else
            "screening_unavailable" if decision.unchecked else "screening_blocked", usage)
    return ScreenedLibrary(_sources(entries), tuple(field for field, _ in entries), (), usage)


def _library_entries(library: CareerLibrary, include_context_requirements: bool):
    """Yield each entry's exact source text for reconstruction and coverage binding."""
    if library.summary and library.summary.strip():
        yield "summary", library.summary
    for field in _ENTRY_FIELDS:
        for entry in getattr(library, field):
            exclude = {"requirement"} if field == "career_contexts" and not include_context_requirements else None
            yield field, entry.model_dump_json(exclude_none=True, exclude=exclude)
