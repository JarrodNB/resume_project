"""Verify push-only fixture startup and the shared runner's final-accounting behavior."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def preserve_test_process_environment():
    with patch.dict(os.environ, dict(os.environ), clear=True):
        yield


def test_health_and_disabled_readiness_do_not_discover_or_claim(monkeypatch):
    from fastapi.testclient import TestClient

    from interviews.fixture_app import RuntimeSettings, create_app

    # Lifespan mutates only its process; restore this test process for other features.
    monkeypatch.setenv("OPENAI_API_KEY", "offline-test")
    settings = RuntimeSettings(False, "http://api:3000", "test", frozenset({"http://s3:9090"}))
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").json() == {"status": "alive", "provider_mode": "fake"}
        assert client.get("/ready").status_code == 503


def test_fake_process_disables_model_requests_and_credentials(monkeypatch):
    from pydantic_ai import models

    from interviews.fixture_app import isolate_fake_process

    monkeypatch.setenv("OPENAI_API_KEY", "cannot-use")
    monkeypatch.setenv("LOGFIRE_TOKEN", "cannot-export")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://cannot-export.invalid")
    isolate_fake_process()
    assert "OPENAI_API_KEY" not in os.environ
    assert "LOGFIRE_TOKEN" not in os.environ
    assert "OTEL_EXPORTER_OTLP_ENDPOINT" not in os.environ
    assert not models.ALLOW_MODEL_REQUESTS


def test_disabled_runtime_needs_no_service_credential(monkeypatch):
    from interviews.fixture_app import RuntimeSettings

    monkeypatch.delenv("INTERVIEW_FAKE_RUNTIME_ENABLED", raising=False)
    monkeypatch.delenv("INTERVIEW_SERVICE_SECRET", raising=False)
    assert not RuntimeSettings.from_environment().enabled



def test_enabled_fixture_is_ready_without_discovery_or_periodic_cleanup(monkeypatch):
    from fastapi.testclient import TestClient

    from interviews.fixture_app import RuntimeSettings, create_app

    calls = []

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def discover(self):
            calls.append("discover")
            return []

        async def cleanup(self):
            calls.append("cleanup")
            return {}

    monkeypatch.setattr("interviews.client.RailsInterviewClient", lambda *args, **kwargs: Client())
    settings = RuntimeSettings(True, "http://rails.test", "synthetic-secret", frozenset({"http://storage.test"}))
    with TestClient(create_app(settings)) as client:
        assert client.get("/ready").json() == {"ready": True}
        client.portal.call(asyncio.sleep, 0.03)
        assert calls == []


def test_finished_execution_heartbeat_allows_final_usage_receipt_to_complete():
    from execution.runner import ExecutionRunner
    from interviews.execution_adapter import InterviewExecutionAdapter

    async def scenario():
        final_usage_started = asyncio.Event()
        release_usage_response = asyncio.Event()
        finalized = []
        heartbeats = []

        class Client:
            async def claim(self, identity):
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim):
                await final_usage_started.wait()
                heartbeats.append(claim.operation_id)
                if len(heartbeats) > 1:
                    raise RuntimeError("Finished executions must not renew their lease")
                return {"execution_finished": True}

        class Executor:
            async def execute(self, claim, **options):
                final_usage_started.set()
                await release_usage_response.wait()
                finalized.append(claim.operation_id)

        runner = ExecutionRunner({"interviews": InterviewExecutionAdapter(Client(), Executor())}, heartbeat_seconds=0.001)
        runner.start("interviews", "accepted-turn")
        execution = runner.active[("interviews", "accepted-turn")]
        try:
            await asyncio.wait_for(final_usage_started.wait(), timeout=1)
            await asyncio.sleep(0.02)
            release_usage_response.set()
            assert await asyncio.wait_for(execution, timeout=1)
            assert finalized == ["accepted-turn"]
            assert heartbeats == ["accepted-turn"]
        finally:
            release_usage_response.set()
            await runner.close()

    asyncio.run(scenario())
