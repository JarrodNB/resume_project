"""Decide whether a practice question's active answer has any text.

Rails owns the active answer (InterviewPrep::ActiveAnswer) and saves its readable text in
`answer_text`; inactive format drafts are never read here. Text is blank when it holds only the
characters Ruby's `[[:space:]]` matches: tab, newline, vertical tab, form feed, carriage return,
space, U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F and U+3000.
U+FEFF, U+180E, U+200B and U+001C-U+001F are text. The set is spelled out below because Python's
`str.strip`, Postgres and JS `trim` each differ. tests/fixtures/active_answer_cases.json
holds the shared cases.
"""
import re

_SPACE_RANGES = [(0x09, 0x0D), (0x20, 0x20), (0x85, 0x85), (0xA0, 0xA0), (0x1680, 0x1680), (0x2000, 0x200A),
                 (0x2028, 0x2029), (0x202F, 0x202F), (0x205F, 0x205F), (0x3000, 0x3000)]
# Written as backslash-u text so the same class works in a Python regex and in a Postgres regex.
_SPACE_CHARACTERS = "".join(
    f"\\u{low:04x}" if low == high else f"\\u{low:04x}-\\u{high:04x}" for low, high in _SPACE_RANGES)
_TEXT = re.compile(f"[^{_SPACE_CHARACTERS}]")

# SQL for the same rule, for readers that flag rows in the database. Postgres reads \uXXXX in a
# regular expression itself, so the result does not depend on the database locale.
ANSWERED_SQL = f"q.answer_text ~ '[^{_SPACE_CHARACTERS}]'"


def has_answer_text(answer_text):
    """True when the saved active answer text is not blank under the shared rule."""
    return bool(answer_text) and _TEXT.search(answer_text) is not None
