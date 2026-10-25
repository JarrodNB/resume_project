"""Grouped answers retain saved identities, limits and fail-closed coverage."""

import asyncio

import pytest

from schemas.gap_response import GapResponseSnapshot
from screening.gap_response_fields import screen_gap_response_fields
from screening.screen_user_text import ScreenOutcome
from screening.session import screening_session
from text_limits import MAX_SCREENED_TEXT


@pytest.mark.parametrize("decision", [ScreenOutcome(False), ScreenOutcome(False, unchecked=True)])
def test_failed_group_earns_no_approval_or_source_coverage(decision):
    async def run():
        async def classify(_):
            return decision
        with screening_session() as session:
            sources = [(GapResponseSnapshot(id="one", requirement="First", body="Answer"), "First: Answer"),
                       (GapResponseSnapshot(id="two", requirement="Second", body="Answer"), "Second: Answer")]
            outcomes = await screen_gap_response_fields(sources, classify)
            assert all(not outcome.allowed for outcome in outcomes.values())
            assert not session.gap_response_screening
            assert not session.allowed_sources
    asyncio.run(run())


@pytest.mark.parametrize("approved", [False, True])
def test_full_group_limit_applies_even_to_saved_approvals(approved):
    async def run():
        async def classify(_):
            pytest.fail("oversized source must not reach classifier")
        snapshot = GapResponseSnapshot(id="one", requirement="Large", body="x" * MAX_SCREENED_TEXT,
            screened_fields=["requirement", "body"] if approved else [])
        with screening_session() as session:
            outcomes = await screen_gap_response_fields([(snapshot, f"Large: {snapshot.body}")], classify)
            assert next(iter(outcomes.values())).too_long
            assert not session.gap_response_screening and not session.allowed_sources
    asyncio.run(run())


def test_session_rechecks_changed_values_and_metadata_is_not_serialized():
    async def run():
        calls = []
        async def classify(text):
            calls.append(text)
            return ScreenOutcome(True)
        snapshot = GapResponseSnapshot(id="one", requirement="Question", body="Answer")
        assert snapshot.model_dump() == {"requirement": "Question", "body": "Answer"}
        with screening_session() as session:
            await screen_gap_response_fields([(snapshot, "Question: Answer")], classify)
            snapshot.body = "Edited"
            await screen_gap_response_fields([(snapshot, "Question: Edited")], classify)
            assert len(calls) == 2
            assert set(session.gap_response_screening[-1].fields) == {"body"}
            assert "Question" not in calls[-1]
    asyncio.run(run())
