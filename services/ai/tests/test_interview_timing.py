"""Check private timing outcomes without exporting content or altering failures."""

import asyncio
from types import SimpleNamespace

import pytest

from interviews.timing import stage_timing


def test_failed_and_cancelled_stages_preserve_errors_and_fenced_identity(monkeypatch):
    ticks = iter([10, 10.125, 20, 20.25])
    monkeypatch.setattr("interviews.timing.time.monotonic", lambda: next(ticks))
    events = []
    monkeypatch.setattr("logfire.info", lambda message, **fields: events.append(fields))
    claim = SimpleNamespace(operation_id="op", attempt_id="second-attempt", claim_generation=2)
    with pytest.raises(ValueError, match="private error"), stage_timing(claim, "transcription"):
        raise ValueError("private error")
    with pytest.raises(asyncio.CancelledError), stage_timing(claim, "speech_synthesis"):
        raise asyncio.CancelledError
    assert [(event["elapsed_ms"], event["outcome"]) for event in events] == [
        (125, "failed"), (250, "cancelled")]
    assert all(event["attempt_id"] == "second-attempt" and event["claim_generation"] == 2 for event in events)
    assert "private error" not in str(events)


def test_telemetry_failure_cannot_replace_execution_failure(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("telemetry unavailable")
    monkeypatch.setattr("logfire.info", broken)
    claim = SimpleNamespace(operation_id="op", attempt_id="attempt", claim_generation=1)
    with pytest.raises(ValueError, match="execution failed"), stage_timing(claim, "acceptance"):
        raise ValueError("execution failed")
