"""
Description: Runs one screen per library fact (the requirement and the response together)
before that fact is labeled into the gap analysis prompt. A blocked or unchecked fact is
left out. Career-library entries copied from a resume are not screened here.
Index:
    - LIBRARY_FACT_OMITTED_WARNING: the warning a task result carries when a fact is omitted
    - select_screened_facts: the facts that passed, plus that warning when any were omitted
"""

from collections.abc import Callable

from schemas.gap_analysis_context import LibraryFact

LIBRARY_FACT_OMITTED_WARNING = "One of your notes was left out."


def select_screened_facts(
    facts: list[LibraryFact], allow_text: Callable[[str], bool] | None
) -> tuple[list[LibraryFact], list[str]]:
    """Keeps every fact when `allow_text` is None (evals). Otherwise each fact is one screen
    of its requirement and response, and a rejection omits it."""
    if allow_text is None:
        return list(facts), []
    kept: list[LibraryFact] = []
    omitted = False
    for fact in facts:
        if allow_text(f"{fact.requirement}\n{fact.response}"):
            kept.append(fact)
        else:
            omitted = True
    warnings = [LIBRARY_FACT_OMITTED_WARNING] if omitted else []
    return kept, warnings
