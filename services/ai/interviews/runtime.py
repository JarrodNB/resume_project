"""Supervise a small amount of Rails-owned work while this process is alive.

Only Rails decides which durable operations can run. Shutdown cancels local work;
its persisted lease expires so another process can recover it without local queues.
Completed local work hints that dependent work may exist; polling remains the
fallback, and repeated visible IDs keep the normal retry cadence. A matching finished
execution receipt ends lease renewal while its bounded final accounting completes.
"""

import asyncio
import logging
import time
from typing import Any

from execution.runner import ExecutionRunner
from interviews.execution_adapter import InterviewExecutionAdapter
from interviews.timing import stage_timing

logger = logging.getLogger(__name__)


class RecoveryRuntime:
    """Discover at most ten IDs, run two claims, and renew each live lease."""

    def __init__(self, client: Any, executor: Any, *, discovery_seconds: float = 2,
                 heartbeat_seconds: float = 10, cleanup_seconds: float = 60):
        self.client = client
        self.executor = executor
        self.discovery_seconds = discovery_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self.cleanup_seconds = cleanup_seconds
        self.runner = ExecutionRunner({"interviews": InterviewExecutionAdapter(client, executor)},
                                      heartbeat_seconds=heartbeat_seconds)
        self.active = self.runner.active
        self._supervisor: asyncio.Task | None = None
        self._stopping = False
        self._last_contact: float | None = None
        self._wake = asyncio.Event()
        self._last_dispatched: dict[str, float] = {}

    @property
    def ready(self) -> bool:
        """Readiness requires a live supervisor and recent Rails contact."""
        return bool(self.runner.ready and self._supervisor and not self._supervisor.done() and not self._stopping
                    and self._last_contact is not None
                    and time.monotonic() - self._last_contact < 30)

    async def start(self) -> None:
        self._stopping = False
        self.runner.reopen()
        self._last_contact = None
        self._wake = asyncio.Event()
        self._last_dispatched.clear()
        self._supervisor = asyncio.create_task(self._supervise())

    async def stop(self) -> None:
        self._stopping = True
        if self._supervisor:
            self._supervisor.cancel()
        if self._supervisor:
            await asyncio.gather(self._supervisor, return_exceptions=True)
        await self.runner.close()

    async def _supervise(self) -> None:
        next_cleanup = 0.0
        while not self._stopping:
            # Clear before requests: a completion during discovery/cleanup must
            # survive until the wait below, even if its new work missed this read.
            self._wake.clear()
            try:
                with stage_timing(None, "discovery"):
                    ids = (await self.client.discover())[:10]
                self._last_contact = time.monotonic()
                visible = set(ids) | {identity for feature, identity in self.active}
                self._last_dispatched = {key: value for key, value in self._last_dispatched.items()
                                         if key in visible}
                for identity in ids:
                    if self._stopping or len(self.active) >= 2:
                        break
                    now = time.monotonic()
                    if ("interviews", identity) not in self.active and now - self._last_dispatched.get(
                        identity, float("-inf")
                    ) >= self.discovery_seconds:
                        self._last_dispatched[identity] = now
                        self.runner.start("interviews", identity)
                        task = self.active.get(("interviews", identity))
                        if task is None:
                            continue
                        task.add_done_callback(lambda completed, key=identity: self._finished(key, completed))
                if time.monotonic() >= next_cleanup:
                    await self.client.cleanup()
                    next_cleanup = time.monotonic() + self.cleanup_seconds
            except Exception as error:  # noqa: BLE001 - supervisor must survive dependency outages
                # Do not log capability-bearing request exceptions or response content.
                logger.warning("Interview discovery or cleanup unavailable (%s)", type(error).__name__)
                next_cleanup = time.monotonic() + self.cleanup_seconds
                # Completion hints must not accelerate retries against an outage.
                await asyncio.sleep(self.discovery_seconds)
                continue
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self.discovery_seconds)
            except TimeoutError:
                pass

    def _finished(self, identity: str, task: asyncio.Task) -> None:
        # Inspect completion safely: cancellations and failed claims/heartbeats
        # must not create callback errors or immediate retry loops.
        if not self._stopping and not task.cancelled() and task.exception() is None and task.result():
            self._wake.set()

    async def _run(self, identity: str) -> bool:
        return await self.runner.run_once("interviews", identity)
