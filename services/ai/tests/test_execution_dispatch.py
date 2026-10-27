"""Check execution receipts, lease fencing and bounded accounting during shutdown."""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI


def test_start_receipt_does_not_wait_for_claim_and_capacity_is_shared():
    from execution.runner import ExecutionRunner
    from routes.executions import install_execution_routes

    async def scenario():
        blocked = asyncio.Event()
        claimed = []

        class Adapter:
            async def claim(self, identity):
                claimed.append(identity)
                await blocked.wait()

        runner = ExecutionRunner({"interviews": Adapter()}, capacity=1)
        app = FastAPI()
        app.state.execution_runner = runner
        install_execution_routes(app, secret=lambda: "private-service-secret")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            identity = str(uuid4())
            headers = {"Authorization": "Bearer private-service-secret"}
            body = {"feature": "interviews", "operation_id": identity}
            assert (await client.post("/internal/executions", json=body)).status_code == 401
            assert (await client.post("/internal/executions", content=b"x" * 4097,
                                      headers=headers)).status_code == 413
            assert (await client.post("/internal/executions", json=body,
                                      headers={b"authorization": b"Bearer \xff"})).status_code == 401
            first = await asyncio.wait_for(client.post("/internal/executions", json=body, headers=headers), 0.2)
            assert first.status_code == 202
            assert first.json() == {**body, "receipt": "received"}
            assert (await client.post("/internal/executions", json=body, headers=headers)).status_code == 202
            saturated = await client.post("/internal/executions", json={**body, "operation_id": str(uuid4())}, headers=headers)
            assert saturated.status_code == 503
            assert saturated.headers["retry-after"] == "1"
            await asyncio.sleep(0)
            assert claimed == [identity]
        await runner.close()

    asyncio.run(scenario())


def test_runner_cancels_execution_on_lost_lease_and_preserves_finished_accounting():
    from execution.runner import ExecutionRunner

    async def scenario(finished):
        stopped = asyncio.Event()
        released = asyncio.Event()
        output_seen = []

        class Adapter:
            async def claim(self, identity):
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=1))

            async def execute(self, claim, output):
                output_seen.append(output)
                try:
                    await released.wait()
                finally:
                    stopped.set()

            async def heartbeat(self, claim):
                if finished:
                    released.set()
                    return {"execution_finished": True}
                raise RuntimeError("lease lost")

        runner = ExecutionRunner({"interviews": Adapter()}, heartbeat_seconds=0.001)
        runner.start("interviews", "operation")
        await asyncio.wait_for(stopped.wait(), 0.5)
        await runner.close()
        assert output_seen == [None]

    asyncio.run(scenario(False))
    asyncio.run(scenario(True))


def test_lost_claim_reply_never_executes_or_blindly_replays_claim():
    from execution.runner import ExecutionRunner

    async def scenario():
        calls = []

        class Adapter:
            async def claim(self, identity):
                calls.append(identity)
                raise RuntimeError("lost owner acknowledgement")

            async def execute(self, claim, output):
                raise AssertionError("An unknown claim must never execute")

        runner = ExecutionRunner({"interviews": Adapter()})
        runner.start("interviews", "one")
        await asyncio.sleep(0.01)
        assert calls == ["one"]
        assert not runner.active
        await runner.close()

    asyncio.run(scenario())


def test_deadline_allows_bounded_accounting_tail_and_stuck_tail_fails_closed():
    from execution.runner import ExecutionRunner

    async def scenario(stuck):
        finished = asyncio.Event()
        release = asyncio.Event()

        class Adapter:
            async def claim(self, identity):
                return SimpleNamespace(operation_id=identity,
                    execution_deadline=datetime.now(UTC) + timedelta(seconds=0.01))

            async def execute(self, claim, output):
                try:
                    await asyncio.Event().wait()
                finally:
                    if stuck:
                        while not release.is_set():
                            try:
                                await release.wait()
                            except asyncio.CancelledError:
                                pass
                    else:
                        await asyncio.sleep(0.005)
                    finished.set()

            async def heartbeat(self, claim):
                return {}

        runner = ExecutionRunner({"interviews": Adapter()}, cleanup_seconds=0.01)
        runner.start("interviews", "one")
        await asyncio.sleep(0.04)
        if stuck:
            assert not runner.ready
            runner.reopen()
            assert runner.start("interviews", "two") == "overloaded"
            await asyncio.wait_for(runner.close(), 0.1)
            release.set()
            await asyncio.wait_for(finished.wait(), 0.1)
        else:
            assert finished.is_set()
        await runner.close()

    asyncio.run(scenario(False))
    asyncio.run(scenario(True))


@pytest.mark.parametrize("cause", ["deadline", "lease_loss"])
def test_close_during_accounting_keeps_surviving_work_fail_closed(cause):
    from execution.runner import ExecutionRunner

    async def scenario():
        accounting_started = asyncio.Event()
        release_accounting = asyncio.Event()
        accounted = asyncio.Event()

        class Adapter:
            async def claim(self, identity):
                return SimpleNamespace(
                    execution_deadline=datetime.now(UTC) + timedelta(
                        seconds=0.01 if cause == "deadline" else 1))

            async def execute(self, claim, output):
                try:
                    await asyncio.Event().wait()
                finally:
                    accounting_started.set()
                    await release_accounting.wait()
                    accounted.set()

            async def heartbeat(self, claim):
                if cause == "lease_loss":
                    raise RuntimeError("lease lost")
                return {}

        runner = ExecutionRunner({"interviews": Adapter()}, cleanup_seconds=0.02,
                                 heartbeat_seconds=0.001)
        assert runner.start("interviews", "one") == "received"
        await asyncio.wait_for(accounting_started.wait(), 0.5)
        try:
            await asyncio.wait_for(runner.close(), 0.5)
            runner.reopen()
            assert not runner.ready
            assert runner.start("interviews", "two") == "overloaded"
            # A later lifespan/owner close must not cancel final accounting again.
            await asyncio.wait_for(runner.close(), 0.5)
            runner.reopen()
            assert not runner.ready
        finally:
            release_accounting.set()
            await asyncio.wait_for(accounted.wait(), 0.5)
            await runner.close()
        runner.reopen()
        assert runner.ready

    asyncio.run(scenario())


def test_close_awaits_accounting_that_finishes_within_the_cleanup_budget():
    from execution.runner import ExecutionRunner

    async def scenario():
        accounting_started = asyncio.Event()
        release_accounting = asyncio.Event()
        accounted = asyncio.Event()

        class Adapter:
            async def claim(self, identity):
                return SimpleNamespace(
                    execution_deadline=datetime.now(UTC) + timedelta(seconds=0.01))

            async def execute(self, claim, output):
                try:
                    await asyncio.Event().wait()
                finally:
                    accounting_started.set()
                    await release_accounting.wait()
                    accounted.set()

            async def heartbeat(self, claim):
                return {}

        runner = ExecutionRunner({"interviews": Adapter()}, cleanup_seconds=0.5)
        runner.start("interviews", "one")
        await asyncio.wait_for(accounting_started.wait(), 0.5)
        # Accounting starts before shutdown and completes independently while close
        # waits. The lifespan may close its clients only after this callback finishes.
        release = asyncio.get_running_loop().call_later(0.01, release_accounting.set)
        try:
            await asyncio.wait_for(runner.close(), 0.5)
            assert accounted.is_set()
        finally:
            release.cancel()
            release_accounting.set()
            await asyncio.wait_for(accounted.wait(), 0.5)
            await runner.close()

    asyncio.run(scenario())


def test_repeated_shutdown_cancellation_does_not_extend_the_cleanup_budget():
    from execution.runner import ExecutionRunner

    async def scenario():
        executing = asyncio.Event()
        accounting_started = asyncio.Event()
        release_accounting = asyncio.Event()
        accounted = asyncio.Event()
        stop_cancelling = asyncio.Event()

        class Adapter:
            async def claim(self, identity):
                return SimpleNamespace(
                    execution_deadline=datetime.now(UTC) + timedelta(seconds=1))

            async def execute(self, claim, output):
                try:
                    executing.set()
                    await asyncio.Event().wait()
                finally:
                    accounting_started.set()
                    await release_accounting.wait()
                    accounted.set()

            async def heartbeat(self, claim):
                return {}

        runner = ExecutionRunner({"interviews": Adapter()}, cleanup_seconds=0.02)
        runner.start("interviews", "one")
        await asyncio.wait_for(executing.wait(), 0.5)
        closing = asyncio.create_task(runner.close())
        await asyncio.wait_for(accounting_started.wait(), 0.5)

        async def repeatedly_cancel_close():
            while not stop_cancelling.is_set():
                closing.cancel()
                # Keep delivering cancellation while letting the drain run.
                await asyncio.sleep(0)

        cancellations = asyncio.create_task(repeatedly_cancel_close())
        try:
            done, _ = await asyncio.wait({closing}, timeout=0.2)
            assert closing in done, "Repeated cancellation extended the cleanup budget"
            assert closing.cancelled()
            runner.reopen()
            assert not runner.ready
        finally:
            stop_cancelling.set()
            await cancellations
            await asyncio.gather(closing, return_exceptions=True)
            release_accounting.set()
            await asyncio.wait_for(accounted.wait(), 0.5)
            await runner.close()

    asyncio.run(scenario())
