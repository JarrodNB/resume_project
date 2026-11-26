"""Check Python's "is this question answered" rule against the cases shared with Rails and the web app.

All three load tests/fixtures/active_answer_cases.json. Rails projects each case's drafts into the
active answer's text; here that text is the saved `answer_text`, and both the Python helper and the
chat list's SQL must agree on whether it counts as answered.
"""
import json
from pathlib import Path

import pytest

from active_answer import has_answer_text
from database.interview_question_bank import read_interview_question_bank
from tests.test_career_library_reader import _insert, _insert_user, admin_connection  # noqa: F401

CASES = json.loads((Path(__file__).parent / "fixtures" / "active_answer_cases.json").read_text())["answers"]
NAMES = [case["name"] for case in CASES]


@pytest.mark.parametrize("case", CASES, ids=NAMES)
def test_python_helper_matches_shared_cases(case):
    assert has_answer_text(case["text"]) is case["answered"]


def test_missing_text_is_not_answered():
    assert has_answer_text(None) is False


@pytest.mark.db
def test_chat_list_sql_matches_shared_cases(admin_connection):  # noqa: F811
    owner = _insert_user(admin_connection)
    for number, case in enumerate(CASES, start=1):
        set_id = _insert(admin_connection, "interview_question_sets", user_id=owner, number=number)
        _insert(admin_connection, "interview_questions", interview_question_set_id=set_id, position=1,
                question_text=f"Q{number}?", answer_text=case["text"])
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    answered = {row["question_text"]: row["answered"] for row in read_interview_question_bank(admin_connection, owner)}
    for number, case in enumerate(CASES, start=1):
        assert answered[f"Q{number}?"] is case["answered"], case["name"]
