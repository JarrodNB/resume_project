"""Check that the explicit paid evidence harness cannot automatically retry failures."""
import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from interviews.execution_adapter import InterviewExecutionAdapter
from scripts.interview_paid_runtime import StopAfterFailureRunner


@pytest.mark.anyio
async def test_failure_pauses_new_starts_before_rails_can_schedule_recovery():
    client = AsyncMock()
    claim = SimpleNamespace(operation_id="operation", execution_deadline=datetime.now(UTC) + timedelta(seconds=120))
    client.claim.return_value = claim
    original_fail = client.fail
    executor = AsyncMock()
    runner = StopAfterFailureRunner({"interviews": InterviewExecutionAdapter(client, executor)})
    failed = asyncio.Event()

    async def execute(claim, **options):
        await client.fail(claim, "provider_unavailable", True)
        failed.set()

    executor.execute.side_effect = execute
    runner.start("interviews", "operation")
    try:
        await asyncio.wait_for(failed.wait(), timeout=1)
        original_fail.assert_awaited_once_with(claim, "provider_unavailable", True)
        executor.execute.assert_awaited_once_with(claim, deadline_managed=True)
        client.claim.assert_awaited_once_with("operation")
        assert not runner.ready
        assert runner.start("interviews", "another") == "overloaded"
    finally:
        await runner.close()
