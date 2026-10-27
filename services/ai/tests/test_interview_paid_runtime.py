"""Check that the explicit paid evidence harness cannot automatically retry failures."""
import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from scripts.interview_paid_runtime import StopAfterFailureRuntime


@pytest.mark.anyio
async def test_failure_stops_discovery_before_rails_can_schedule_recovery():
    client = AsyncMock()
    client.discover.return_value = ["operation"]
    claim = SimpleNamespace(operation_id="operation", execution_deadline=datetime.now(UTC) + timedelta(seconds=120))
    client.claim.return_value = claim
    original_fail = client.fail
    executor = AsyncMock()
    runtime = StopAfterFailureRuntime(client, executor)
    runtime.discovery_seconds = 0.001
    failed = asyncio.Event()

    async def execute(claim, **options):
        await client.fail(claim, "provider_unavailable", True)
        failed.set()

    executor.execute.side_effect = execute
    await runtime.start()
    try:
        await asyncio.wait_for(failed.wait(), timeout=1)
        await asyncio.sleep(0.03)
        original_fail.assert_awaited_once_with(claim, "provider_unavailable", True)
        executor.execute.assert_awaited_once_with(claim, deadline_managed=True)
        client.claim.assert_awaited_once_with("operation")
        assert not runtime.ready
        assert runtime.runner.start("interviews", "another") == "overloaded"
    finally:
        await runtime.stop()
