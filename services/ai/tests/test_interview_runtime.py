"""Exercise recovery scheduling through its public runtime boundary without Rails."""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def preserve_test_process_environment():
    """Process isolation belongs to the runtime, not unrelated tests in this interpreter."""
    with patch.dict(os.environ, dict(os.environ), clear=True):
        yield


def test_discovery_is_bounded_and_shutdown_cancels_recoverable_claims():
    from interviews.runtime import RecoveryRuntime

    async def scenario():
        class Client:
            def __init__(self):
                self.claimed = []
                self.cleanups = 0

            async def discover(self):
                return [str(i) for i in range(25)]

            async def claim(self, identity):
                self.claimed.append(identity)
                return SimpleNamespace(operation_id=identity)

            async def heartbeat(self, claim, checkpoint=None):
                return {}

            async def cleanup(self):
                self.cleanups += 1

        class Executor:
            async def execute(self, claim):
                await asyncio.Event().wait()

        client = Client()
        runtime = RecoveryRuntime(client, Executor(), discovery_seconds=0.01)
        await runtime.start()
        await asyncio.sleep(0.04)
        assert len(client.claimed) == 2
        assert runtime.ready
        await runtime.stop()
        assert not runtime.ready
        assert not runtime.active
        assert client.cleanups == 1

    asyncio.run(scenario())


def test_lost_heartbeat_stops_local_execution_before_another_provider_call():
    from interviews.runtime import RecoveryRuntime

    async def scenario():
        stopped = asyncio.Event()

        class Client:
            async def claim(self, identity):
                return SimpleNamespace(operation_id=identity)

            async def heartbeat(self, claim):
                raise RuntimeError("expired claim")

        class Executor:
            async def execute(self, claim):
                try:
                    await asyncio.Event().wait()
                finally:
                    stopped.set()

        runtime = RecoveryRuntime(Client(), Executor(), heartbeat_seconds=0.001)
        await runtime._run("one")
        assert stopped.is_set()

    asyncio.run(scenario())


def test_health_and_disabled_readiness_do_not_discover_or_claim(monkeypatch):
    from fastapi.testclient import TestClient

    from interviews.app import RuntimeSettings, create_app

    # Lifespan mutates only its process; restore this test process for other features.
    monkeypatch.setenv("OPENAI_API_KEY", "offline-test")
    settings = RuntimeSettings(False, "http://api:3000", "test", frozenset({"http://s3:9090"}))
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").json() == {"status": "alive", "provider_mode": "fake"}
        assert client.get("/ready").status_code == 503


def test_fake_process_disables_model_requests_and_credentials(monkeypatch):
    from pydantic_ai import models

    from interviews.app import isolate_fake_process

    monkeypatch.setenv("OPENAI_API_KEY", "cannot-use")
    monkeypatch.setenv("LOGFIRE_TOKEN", "cannot-export")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://cannot-export.invalid")
    isolate_fake_process()
    assert "OPENAI_API_KEY" not in os.environ
    assert "LOGFIRE_TOKEN" not in os.environ
    assert "OTEL_EXPORTER_OTLP_ENDPOINT" not in os.environ
    assert not models.ALLOW_MODEL_REQUESTS


def test_disabled_runtime_needs_no_service_credential(monkeypatch):
    from interviews.app import RuntimeSettings

    monkeypatch.delenv("INTERVIEW_FAKE_RUNTIME_ENABLED", raising=False)
    monkeypatch.delenv("INTERVIEW_SERVICE_SECRET", raising=False)
    assert not RuntimeSettings.from_environment().enabled


def test_runtime_reports_discovery_and_claim_wait_without_returned_claim_data(monkeypatch):
    from interviews.runtime import RecoveryRuntime

    events = []
    monkeypatch.setattr("logfire.info", lambda message, **fields: events.append((message, fields)))

    async def scenario():
        finished = asyncio.Event()

        class Client:
            async def discover(self):
                return ["private-operation"]

            async def claim(self, identity):
                return SimpleNamespace(operation_id=identity, payload="private-transcript")

            async def heartbeat(self, claim):
                return {}

            async def cleanup(self):
                return {}

        class Executor:
            async def execute(self, claim):
                finished.set()

        runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=0.01)
        await runtime.start()
        await asyncio.wait_for(finished.wait(), timeout=1)
        await runtime.stop()

    asyncio.run(scenario())
    stages = {fields["stage"] for message, fields in events if message == "interview.stage"}
    assert {"discovery", "claim"} <= stages
    assert "private-transcript" not in str(events)
    assert "private-operation" not in str(events)
