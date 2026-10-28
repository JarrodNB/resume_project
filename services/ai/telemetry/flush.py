"""
Description: Bounds caller waiting for SDK flushes that may ignore their own timeout.
Index:
    - BoundedTelemetryFlush: shares at most one daemon flush attempt with no queued work
"""

import logging
from collections.abc import Callable
from threading import Event, Lock, Thread


class BoundedTelemetryFlush:
    """Allows one active SDK flush; callers wait a bounded time for that shared attempt."""

    def __init__(self, flush: Callable[[], object]) -> None:
        """Stores the SDK operation without starting background work."""
        self._flush = flush
        self._lock = Lock()
        self._completed: Event | None = None

    def flush(self, timeout_seconds: float = 5.0) -> None:
        """Starts or shares one attempt, returning even if the exporter never returns."""
        with self._lock:
            if self._completed is None or self._completed.is_set():
                self._completed = Event()
                Thread(
                    target=self._run,
                    args=(self._completed,),
                    name="telemetry-flush",
                    daemon=True,
                ).start()
            completed = self._completed
        completed.wait(timeout_seconds)

    def _run(self, completed: Event) -> None:
        """Completes the attempt without propagating exporter errors to task responses."""
        try:
            self._flush()
        except Exception:  # noqa: BLE001 — isolate all third-party exporter failures
            # Telemetry cannot turn a successfully published result into a task failure.
            # Avoid exporting exception text, which could contain exporter payloads.
            logging.getLogger(__name__).warning("Telemetry flush failed; task processing continues")
        finally:
            completed.set()
