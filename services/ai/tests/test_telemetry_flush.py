"""
Description: Verifies caller deadlines independently of SDK timeout enforcement.
Index:
    - test_blocked_flush_shares_one_attempt: bounded caller wait and no queued flush work
    - test_completed_flush_can_run_again: subsequent tasks still flush after success
    - test_exporter_failure_does_not_fail_caller: telemetry errors remain isolated
"""

from threading import Event
from threading import enumerate as active_threads
from time import monotonic

from telemetry.flush import BoundedTelemetryFlush


def test_blocked_flush_shares_one_attempt():
    """A controlled indefinitely blocked exporter cannot queue work or delay callers."""
    started = Event()
    release = Event()
    finished = Event()
    calls = []

    def blocked_sdk_flush():
        """Ignores the SDK timeout, as the current OTel batch exporter can do."""
        calls.append(True)
        started.set()
        release.wait()
        finished.set()

    bounded = BoundedTelemetryFlush(blocked_sdk_flush)
    began = monotonic()
    try:
        bounded.flush(timeout_seconds=0.02)
        assert started.is_set()
        for _ in range(4):
            bounded.flush(timeout_seconds=0.02)
        assert monotonic() - began < 0.5
        assert calls == [True]
        workers = [thread for thread in active_threads() if thread.name == "telemetry-flush"]
        assert len(workers) == 1
        assert workers[0].daemon
    finally:
        release.set()
        assert finished.wait(1.0)
    # An additional queued task would immediately call the now-unblocked function again.
    assert calls == [True]


def test_completed_flush_can_run_again():
    """Each completed attempt allows the next task to flush successfully."""
    calls = []
    bounded = BoundedTelemetryFlush(lambda: calls.append(True))
    bounded.flush(timeout_seconds=1.0)
    bounded.flush(timeout_seconds=1.0)
    assert calls == [True, True]


def test_exporter_failure_does_not_fail_caller():
    """An exporter exception leaves the caller safe and allows later attempts."""
    calls = []

    def failed_flush():
        """Simulates a backend failure without including any real payload."""
        calls.append(True)
        raise ValueError("synthetic export failure")

    bounded = BoundedTelemetryFlush(failed_flush)
    bounded.flush(timeout_seconds=1.0)
    bounded.flush(timeout_seconds=1.0)
    assert calls == [True, True]
