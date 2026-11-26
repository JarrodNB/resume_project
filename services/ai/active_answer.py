"""Decide whether a practice question's active answer has any text.

Rails owns the active answer (InterviewPrep::ActiveAnswer) and saves its readable text in
`answer_text`; inactive format drafts are never read here. An answer is blank when it has no
character other than space, tab, newline, vertical tab, form feed or carriage return. Other
Unicode spaces (like a no-break space) count as text. The same rule runs in Rails and the web
app; tests/fixtures/active_answer_cases.json holds the shared cases.
"""
import re

_TEXT = re.compile(r"[^ \t\n\v\f\r]")

# SQL for the same rule, for readers that filter or flag rows in the database.
ANSWERED_SQL = r"q.answer_text ~ '[^ \t\n\v\f\r]'"


def has_answer_text(answer_text):
    """True when the saved active answer text is not blank under the shared rule."""
    return bool(answer_text) and _TEXT.search(answer_text) is not None
