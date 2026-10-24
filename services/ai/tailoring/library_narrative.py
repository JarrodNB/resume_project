"""Count narrative evidence, excluding identity, dates, contact and bare skill labels.

This mirrors the Rails eligibility check but reads the current owner-scoped snapshot
at worker execution time, since the library can change after a task is queued.
"""

import re

from schemas.gap_analysis_context import CareerLibrary

MIN_TWO_PAGE_WORDS = 700


def narrative_word_count(library: CareerLibrary) -> int:
    texts = [library.summary or ""]
    for record in library.experiences:
        texts.append(record.description or "")
        texts.extend(highlight.content for highlight in record.highlights)
    for records in (library.projects, library.educations, library.certifications):
        texts.extend(record.description or "" for record in records)
    texts.extend(fact.response for fact in library.facts)
    return sum(len(re.findall(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", text)) for text in texts)
