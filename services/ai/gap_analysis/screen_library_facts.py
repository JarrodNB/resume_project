"""
Description: Runs one screen per library fact (the requirement and the response together)
before that fact is labeled into the gap analysis prompt. A blocked or unchecked fact is
left out. Career-library entries copied from a resume are not screened here.
Index:
    - LIBRARY_FACT_OMITTED_WARNING: the warning when a fact fails the safety screen
    - select_screened_facts: the facts that passed, plus a warning when any were omitted
"""

from collections.abc import Callable

from schemas.gap_analysis_context import LibraryFact
from text_limits import NOTE_TOO_LONG_WARNING

LIBRARY_FACT_OMITTED_WARNING = "One of your notes was left out."


def select_screened_facts(
    facts: list[LibraryFact], allow_text: Callable[[str], object] | None
) -> tuple[list[LibraryFact], list[str]]:
    """Keeps every fact when `allow_text` is None (evals). Otherwise each fact is one screen
    of its requirement and response. A bool False is a safety omission. An outcome with
    `too_long` uses the length warning instead."""
    if allow_text is None:
        return list(facts), []
    kept: list[LibraryFact] = []
    omitted = False
    too_long = False
    for fact in facts:
        allowed, over_cap = _decision(allow_text(f"{fact.requirement}\n{fact.response}"))
        if allowed:
            kept.append(fact)
        elif over_cap:
            too_long = True
        else:
            omitted = True
    warnings: list[str] = []
    if omitted:
        warnings.append(LIBRARY_FACT_OMITTED_WARNING)
    if too_long:
        warnings.append(NOTE_TOO_LONG_WARNING)
    return kept, warnings


def _decision(value: object) -> tuple[bool, bool]:
    """(allowed, too_long). A bool is a safety decision with no size flag."""
    if isinstance(value, bool):
        return value, False
    return bool(getattr(value, "allowed", False)), bool(getattr(value, "too_long", False))
