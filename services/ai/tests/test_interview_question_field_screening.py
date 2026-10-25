"""Saved practice checks keep source limits, revisions and conservative failed decisions."""

import pytest

from screening.interview_question_fields import screen_interview_field
from screening.screen_user_text import ScreenOutcome
from screening.session import screening_session
from text_limits import MAX_SCREENED_TEXT


@pytest.mark.parametrize("approved", [False, True])
def test_approved_practice_text_still_obeys_source_limit(approved):
    source = {"question_id": "one", "question_revision": 1, "screened_fields": ["question_text"] if approved else []}
    with screening_session() as session:
        outcome = screen_interview_field(source, "question_text", "x" * (MAX_SCREENED_TEXT + 1),
            lambda _: pytest.fail("oversized source reached classifier"))
        assert outcome.too_long
        assert not session.allowed_sources and not session.interview_question_screening


@pytest.mark.parametrize("unchecked", [False, True])
def test_failed_equal_source_never_earns_another_identity(unchecked):
    calls = []
    with screening_session() as session:
        for id in ("one", "two"):
            source = {"question_id": id, "question_revision": 1, "screened_fields": []}
            outcome = screen_interview_field(source, "question_text", "Shared text",
                lambda text: calls.append(text) or ScreenOutcome(False, unchecked=unchecked))
            assert not outcome.allowed
        assert calls == ["Shared text"]
        assert not session.interview_question_screening
