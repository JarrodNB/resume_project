"""Run bounded, owner-claimed work for any interactive AI feature.

The durable owner supplies claims and renews their leases. Local task registration
is only a capacity reservation: an HTTP receipt never proves durable delivery.
Feature adapters retain their own provider, acceptance and accounting contracts.
Shutdown allows bounded accounting cleanup and retains unfinished work locally.
"""

import asyncio
import logging
from datetime import UTC, datetime

from opentelemetry import trace

logger = logging.getLogger(__name__)


class ExecutionRunner:
    """Share one capacity limit, lease monitor and shutdown path across features."""

    def __init__(self, adapters, *, capacity=2, heartbeat_seconds=10, cleanup_seconds=30, output_factory=None):
        if capacity < 1 or heartbeat_seconds <= 0 or cleanup_seconds <= 0:
            raise ValueError("Execution limits must be positive")
        self.adapters = dict(adapters)
        self.capacity = capacity
        self.heartbeat_seconds = heartbeat_seconds
        self.output_factory = output_factory
        self.cleanup_seconds = cleanup_seconds
        self.active = {}
        self._closed = False
        self._unhealthy = False
        self._tails = set()

    @property
    def ready(self):
        return not self._closed and not self._unhealthy

    def start(self, feature, operation_id):
        """Reserve without awaiting the owner; reject excess work before claiming."""
        if feature not in self.adapters:
            raise ValueError("Unknown execution feature")
        key = (feature, str(operation_id))
        if key in self.active:
            return "received"
        if not self.ready or len(self.active) >= self.capacity:
            return "overloaded"
        # Execution outlives its HTTP receipt and owns a complete priced trace.
        # Replace only the parent span; retain privacy and other task context.
        # No await separates the capacity check from registration on this loop.
        with trace.use_span(trace.INVALID_SPAN):
            task = asyncio.create_task(self.run_once(feature, str(operation_id)))
        self.active[key] = task
        task.add_done_callback(lambda completed: self._finished(key, completed))
        return "received"

    def _finished(self, key, task):
        self.active.pop(key, None)
        if not task.cancelled():
            task.exception()  # Consume unexpected task failures without logging inputs.

    async def run_once(self, feature, operation_id):
        """Execute a canonical claim; ambiguous receipts stay with durable recovery."""
        adapter = self.adapters[feature]
        try:
            claim = await adapter.claim(operation_id)
            remaining = (claim.execution_deadline - datetime.now(UTC)).total_seconds()
            if remaining <= 0:
                return False
            output = self.output_factory(feature, claim) if self.output_factory else None
            execution = asyncio.create_task(adapter.execute(claim, output))
            heartbeat = asyncio.create_task(self._heartbeat(adapter, claim))
            try:
                async with asyncio.timeout(remaining):
                    done, _ = await asyncio.wait({execution, heartbeat}, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        task.result()
                    if heartbeat in done:
                        # A finished lease receipt must not truncate final accounting.
                        await execution
            finally:
                await self._drain([execution, heartbeat])
            return True
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - the durable owner handles recovery
            logger.warning("AI execution stopped; owner recovery remains active (%s)", type(error).__name__)
            return False

    async def _heartbeat(self, adapter, claim):
        while True:
            await asyncio.sleep(self.heartbeat_seconds)
            receipt = await adapter.heartbeat(claim)
            if receipt.get("execution_finished") is True:
                return

    async def close(self):
        """Stop work and await bounded cleanup, retaining any unfinished tails."""
        self._closed = True
        await self._drain([*self.active.values(), *self._tails])

    def pause(self):
        """Refuse new work while allowing admitted work to finish its accounting."""
        self._closed = True

    async def _drain(self, tasks):
        if not tasks:
            return
        for task in tasks:
            # A second cancellation would interrupt an adapter's final accounting.
            if not task.cancelling():
                task.cancel()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.cleanup_seconds
        interrupted = False
        while True:
            try:
                done, pending = await asyncio.wait(
                    tasks, timeout=max(0, deadline - loop.time()))
                break
            except asyncio.CancelledError:
                # Shutdown can cancel run_once while it is already draining. Keep
                # supervising its children within the original bound before exiting.
                interrupted = True
                if loop.time() >= deadline:
                    done = {task for task in tasks if task.done()}
                    pending = set(tasks) - done
                    break
        for task in done:
            if not task.cancelled():
                task.exception()
        if pending:
            # A broken adapter must not release unlimited new work behind a stuck tail.
            self._unhealthy = True
            for task in pending:
                if task not in self._tails:
                    self._tails.add(task)
                    task.add_done_callback(self._tail_finished)
        if interrupted:
            raise asyncio.CancelledError

    def _tail_finished(self, task):
        self._tails.discard(task)
        if not task.cancelled():
            task.exception()
        if not self._tails:
            # The stuck work is gone, so health recovers. A shutdown stays closed.
            self._unhealthy = False

    def reopen(self):
        if not self._tails:
            self._closed = False
            self._unhealthy = False
