"""
Description: Text normalisation helpers for deterministic evaluators. Comparisons ignore case,
whitespace (including line breaks from PDF extraction), and leading bullet characters.
Index:
    - normalize_text: lower-cases, strips bullets, and collapses whitespace
    - appears_in: whether one string appears inside another after normalisation
    - loosely_equal: whether either normalised string contains the other
    - fraction: matched / total, or 1.0 when there is nothing to check
"""

import re

BULLET_PREFIX = re.compile(r"^[\s•\-\*–·]+")
WHITESPACE = re.compile(r"\s+")


def normalize_text(text: str | None) -> str:
    """Lower-cases text, removes a leading bullet, and collapses all whitespace to one space."""
    if not text:
        return ""
    return WHITESPACE.sub(" ", BULLET_PREFIX.sub("", text)).strip().lower()


def appears_in(needle: str | None, haystack: str) -> bool:
    """True when the normalised needle is a substring of the normalised haystack."""
    normalized_needle = normalize_text(needle)
    return bool(normalized_needle) and normalized_needle in normalize_text(haystack)


def loosely_equal(first: str | None, second: str | None) -> bool:
    """True when either normalised string contains the other (e.g. 'Acme' vs 'Acme Inc.')."""
    normalized_first, normalized_second = normalize_text(first), normalize_text(second)
    if not normalized_first or not normalized_second:
        return False
    return normalized_first in normalized_second or normalized_second in normalized_first


def fraction(matched: int, total: int) -> float:
    """Returns matched / total, treating 'nothing to check' as a perfect score."""
    return 1.0 if total == 0 else matched / total
