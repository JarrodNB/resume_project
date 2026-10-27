"""Check immediate execution receipts, capacity and durable-owner lease fencing."""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
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
