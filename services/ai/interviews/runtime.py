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
        self.active: dict[str, asyncio.Task] = {}
        self._supervisor: asyncio.Task | None = None
        self._stopping = False
        self._last_contact: float | None = None
        self._wake = asyncio.Event()
        self._last_dispatched: dict[str, float] = {}

    @property
    def ready(self) -> bool:
        """Readiness requires a live supervisor and recent Rails contact."""
        return bool(self._supervisor and not self._supervisor.done() and not self._stopping
                    and self._last_contact is not None
                    and time.monotonic() - self._last_contact < 30)

    async def start(self) -> None:
        self._stopping = False
        self._last_contact = None
        self._wake = asyncio.Event()
        self._last_dispatched.clear()
        self._supervisor = asyncio.create_task(self._supervise())

    async def stop(self) -> None:
        self._stopping = True
        if self._supervisor:
            self._supervisor.cancel()
        tasks = [task for task in [self._supervisor, *self.active.values()] if task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.active.clear()

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
                visible = set(ids) | self.active.keys()
                self._last_dispatched = {key: value for key, value in self._last_dispatched.items()
                                         if key in visible}
                for identity in ids:
                    if self._stopping or len(self.active) >= 2:
                        break
                    now = time.monotonic()
                    if identity not in self.active and now - self._last_dispatched.get(
                        identity, float("-inf")
                    ) >= self.discovery_seconds:
                        self._last_dispatched[identity] = now
                        task = asyncio.create_task(self._run(identity))
                        self.active[identity] = task
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
        self.active.pop(identity, None)
        # Inspect completion safely: cancellations and failed claims/heartbeats
        # must not create callback errors or immediate retry loops.
        if not self._stopping and not task.cancelled() and task.exception() is None and task.result():
            self._wake.set()

    async def _run(self, identity: str) -> bool:
        try:
            with stage_timing(None, "claim"):
                claim = await self.client.claim(identity)
            execution = asyncio.create_task(self.executor.execute(claim))
            heartbeat = asyncio.create_task(self._heartbeat(claim))
            try:
                done, _ = await asyncio.wait({execution, heartbeat},
                                             return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
                # A finished-execution heartbeat is not lease loss. The executor
                # still owns its bounded acceptance/accounting HTTP response.
                if heartbeat in done:
                    await execution
            finally:
                execution.cancel()
                heartbeat.cancel()
                await asyncio.gather(execution, heartbeat, return_exceptions=True)
            return True
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - durable Rails recovery owns retry policy
            # Lost claim or network failure must never continue provider work unchecked.
            logger.warning("Interview execution stopped; durable recovery remains in Rails (%s)",
                           type(error).__name__)
            return False

    async def _heartbeat(self, claim: Any) -> None:
        while True:
            await asyncio.sleep(self.heartbeat_seconds)
            receipt = await self.client.heartbeat(claim)
            if receipt.get("execution_finished") is True:
                return
