"""Successful-check reports remain bounded, text-free, and backwards compatible."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from worker.queue_messages import AiResultMessage


def message(**fields):
    return AiResultMessage(ai_task_id=uuid4(), status="failed", **fields)


def test_legacy_results_need_no_screening_reports():
    assert message().screening_successes == []


def test_success_metadata_serializes_without_source_or_owner():
    report = {"content_digest": "a" * 64, "policy_identity": "b" * 64}
    assert message(screening_successes=[report]).model_dump()["screening_successes"] == [report]


@pytest.mark.parametrize("reports", [
    None, {}, [{"content_digest": "A" * 64, "policy_identity": "b" * 64}],
    [{"content_digest": "a" * 63, "policy_identity": "b" * 64}],
    [{"content_digest": "a" * 64 + "\n", "policy_identity": "b" * 64}],
    [{"content_digest": "a" * 64, "policy_identity": "b" * 64, "text": "source"}],
    [{"content_digest": "a" * 64, "policy_identity": "b" * 64, "user_id": str(uuid4())}],
    [{"content_digest": "a" * 64, "policy_identity": "b" * 64}] * 1001,
])
def test_invalid_or_unbounded_metadata_cannot_be_published(reports):
    with pytest.raises(ValidationError):
        message(screening_successes=reports)
