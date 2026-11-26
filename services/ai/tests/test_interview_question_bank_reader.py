"""Verify the chat practice-question reader with real ai_reader grants: owner, active slots and order."""
from datetime import UTC, datetime

import pytest
from psycopg.types.json import Jsonb

from database.interview_question_bank import read_interview_question_bank
from tests.test_career_library_reader import _insert, _insert_user, admin_connection  # noqa: F401

pytestmark = pytest.mark.db


def _set(connection, user, number, created_at, set_type="behavioral"):
    set_id = _insert(connection, "interview_question_sets", user_id=user, number=number, set_type=set_type)
    connection.execute("UPDATE interview_question_sets SET created_at = %s WHERE id = %s", (created_at, set_id))
    return set_id


def test_reads_only_owned_active_questions_newest_set_first_then_position(admin_connection):  # noqa: F811
    connection = admin_connection
    owner, other = _insert_user(connection), _insert_user(connection)
    older = _set(connection, owner, 1, datetime(2025, 1, 1, tzinfo=UTC), "fit_motivation")
    newer = _set(connection, owner, 2, datetime(2026, 1, 1, tzinfo=UTC))
    foreign = _set(connection, other, 1, datetime(2026, 6, 1, tzinfo=UTC))
    second = _insert(connection, "interview_questions", interview_question_set_id=newer, position=2,
                     question_text="Describe a conflict.", answer_text="  \n ")
    first = _insert(connection, "interview_questions", interview_question_set_id=newer, position=1,
                    question_text="Describe a win.", answer_text="I shipped.", answer_revision=2,
                    feedback=Jsonb({"strengths": ["Clear"]}), feedback_question_revision=1, feedback_answer_revision=2)
    old = _insert(connection, "interview_questions", interview_question_set_id=older, position=1,
                  question_text="Why us?")
    _insert(connection, "interview_questions", interview_question_set_id=older, position=None,
            question_text="Retired copy", retired_at=datetime.now(UTC))
    _insert(connection, "interview_questions", interview_question_set_id=foreign, position=1,
            question_text="Private question")
    connection.execute("SET LOCAL ROLE ai_reader")

    rows = read_interview_question_bank(connection, owner)

    assert [row["id"] for row in rows] == [str(first), str(second), str(old)]
    assert [row["set_number"] for row in rows] == [2, 2, 1]
    assert rows[2]["set_type"] == "fit_motivation"
    assert [row["answered"] for row in rows] == [True, False, False]
    assert [row["has_feedback"] for row in rows] == [True, False, False]
    assert rows[0]["feedback_answer_revision"] == 2 and rows[0]["answer_format_revision"] == 0
    assert "answer_text" not in rows[0] and "feedback" not in rows[0]
    assert read_interview_question_bank(connection, other)[0]["question_text"] == "Private question"


def test_limit_includes_one_overflow_row_and_rejects_larger_limits(admin_connection):  # noqa: F811
    connection = admin_connection
    owner = _insert_user(connection)
    question_set = _set(connection, owner, 1, datetime(2026, 1, 1, tzinfo=UTC))
    for position in range(1, 4):
        _insert(connection, "interview_questions", interview_question_set_id=question_set, position=position,
                question_text=f"Question {position}")
    connection.execute("SET LOCAL ROLE ai_reader")
    assert len(read_interview_question_bank(connection, owner, limit=2)) == 2
    with pytest.raises(ValueError):
        read_interview_question_bank(connection, owner, limit=502)
