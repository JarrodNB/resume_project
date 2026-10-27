"""Exercise recovery scheduling through its public runtime boundary without Rails."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
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
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim, checkpoint=None):
                return {}

            async def cleanup(self):
                self.cleanups += 1

        class Executor:
            async def execute(self, claim, **options):
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
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim):
                raise RuntimeError("expired claim")

        class Executor:
            async def execute(self, claim, **options):
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


def test_runtime_keeps_local_discovery_timings_without_claim_data(caplog):
    from interviews.runtime import RecoveryRuntime

    caplog.set_level("DEBUG", logger="interviews.timing")

    async def scenario():
        finished = asyncio.Event()

        class Client:
            async def discover(self):
                return ["private-operation"]

            async def claim(self, identity):
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120), payload="private-transcript")

            async def heartbeat(self, claim):
                return {}

            async def cleanup(self):
                return {}

        class Executor:
            async def execute(self, claim, **options):
                finished.set()

        runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=0.01)
        await runtime.start()
        await asyncio.wait_for(finished.wait(), timeout=1)
        await runtime.stop()

    asyncio.run(scenario())
    records = [record for record in caplog.records if record.name == "interviews.timing"]
    assert {"discovery", "claim"} <= {record.stage for record in records}
    assert "private-transcript" not in str([record.__dict__ for record in records])
    assert "private-operation" not in str([record.__dict__ for record in records])


def test_completed_turn_wakes_durable_discovery_before_idle_poll_deadline():
    from interviews.runtime import RecoveryRuntime

    async def scenario():
        speech_claimed = asyncio.Event()
        pending = ["turn"]
        discoveries = []

        class Client:
            async def discover(self):
                discoveries.append(list(pending))
                return list(pending)

            async def claim(self, identity):
                pending.remove(identity)
                if identity == "speech":
                    speech_claimed.set()
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim):
                return {}

            async def cleanup(self):
                return {}

        class Executor:
            async def execute(self, claim, **options):
                if claim.operation_id == "turn":
                    pending.append("speech")

        runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=1)
        await runtime.start()
        try:
            await asyncio.wait_for(speech_claimed.wait(), timeout=0.2)
            assert discoveries[:2] == [["turn"], ["speech"]]
        finally:
            await runtime.stop()
        assert not runtime.active

    asyncio.run(scenario())


def test_completion_during_inflight_discovery_is_not_lost():
    from interviews.runtime import RecoveryRuntime

    async def scenario():
        pending = ["first", "second"]
        reading = asyncio.Event()
        release_read = asyncio.Event()
        release_second = asyncio.Event()
        second_completed = asyncio.Event()
        speech_claimed = asyncio.Event()
        discoveries = 0

        class Client:
            async def discover(self):
                nonlocal discoveries
                discoveries += 1
                snapshot = list(pending)
                if discoveries == 2:
                    reading.set()
                    await release_read.wait()
                return snapshot

            async def claim(self, identity):
                pending.remove(identity)
                if identity == "speech":
                    speech_claimed.set()
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim):
                return {}

            async def cleanup(self):
                return {}

        class Executor:
            async def execute(self, claim, **options):
                if claim.operation_id == "second":
                    await release_second.wait()
                    pending.append("speech")
                    second_completed.set()

        runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=1)
        await runtime.start()
        try:
            await asyncio.wait_for(reading.wait(), timeout=0.2)
            release_second.set()
            await asyncio.wait_for(second_completed.wait(), timeout=0.2)
            release_read.set()
            await asyncio.wait_for(speech_claimed.wait(), timeout=0.2)
            assert discoveries >= 3
        finally:
            await runtime.stop()

    asyncio.run(scenario())


@pytest.mark.parametrize("failure", ["none", "claim", "discovery", "execution"])
def test_stale_operations_and_failures_keep_bounded_retry_load(failure):
    from interviews.runtime import RecoveryRuntime

    async def scenario():
        discoveries = 0
        claims = 0
        unhandled = []
        asyncio.get_running_loop().set_exception_handler(lambda loop, context: unhandled.append(context))

        class Client:
            async def discover(self):
                nonlocal discoveries
                discoveries += 1
                if failure == "discovery":
                    raise RuntimeError("private dependency failure")
                return ["stale"]

            async def claim(self, identity):
                nonlocal claims
                claims += 1
                if failure == "claim":
                    raise RuntimeError("stale claim")
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim):
                return {}

            async def cleanup(self):
                return {}

        class Executor:
            async def execute(self, claim, **options):
                if failure == "execution":
                    raise RuntimeError("private execution failure")
                # A stale/no-op executor may return without changing discovery.

        runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=0.025)
        await runtime.start()
        await asyncio.sleep(0.085)
        await runtime.stop()
        assert 1 <= discoveries <= 8
        assert claims <= 4
        assert not unhandled
        assert not runtime.active

    asyncio.run(scenario())


def test_shutdown_cancels_waits_and_same_runtime_can_recover_after_restart():
    from interviews.runtime import RecoveryRuntime

    async def scenario():
        started = asyncio.Event()
        cancelled = asyncio.Event()
        recovered = asyncio.Event()
        claims = 0

        class Client:
            async def discover(self):
                return ["recoverable"]

            async def claim(self, identity):
                nonlocal claims
                claims += 1
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim):
                return {}

            async def cleanup(self):
                return {}

        class Executor:
            async def execute(self, claim, **options):
                if claims == 1:
                    started.set()
                    try:
                        await asyncio.Event().wait()
                    finally:
                        cancelled.set()
                else:
                    recovered.set()

        runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=1)
        await runtime.start()
        await asyncio.wait_for(started.wait(), timeout=0.2)
        await runtime.stop()
        assert cancelled.is_set()
        assert not runtime.ready
        await runtime.start()
        try:
            await asyncio.wait_for(recovered.wait(), timeout=0.2)
            assert claims == 2
        finally:
            await runtime.stop()
        assert not runtime.active

    asyncio.run(scenario())


def test_completion_hint_during_discovery_outage_does_not_bypass_backoff():
    from interviews.runtime import RecoveryRuntime

    async def scenario():
        pending = ["first", "second"]
        failed_read = asyncio.Event()
        release_read = asyncio.Event()
        finish_second = asyncio.Event()
        completed_second = asyncio.Event()
        speech_claimed = asyncio.Event()
        discoveries = 0

        class Client:
            async def discover(self):
                nonlocal discoveries
                discoveries += 1
                if discoveries == 2:
                    failed_read.set()
                    await release_read.wait()
                    raise RuntimeError("dependency unavailable")
                return list(pending)

            async def claim(self, identity):
                pending.remove(identity)
                if identity == "speech":
                    speech_claimed.set()
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim):
                return {}

            async def cleanup(self):
                return {}

        class Executor:
            async def execute(self, claim, **options):
                if claim.operation_id == "second":
                    await finish_second.wait()
                    pending.append("speech")
                    completed_second.set()

        runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=0.2)
        await runtime.start()
        try:
            await asyncio.wait_for(failed_read.wait(), timeout=0.1)
            finish_second.set()
            await asyncio.wait_for(completed_second.wait(), timeout=0.1)
            release_read.set()
            await asyncio.sleep(0.04)
            assert discoveries == 2
            await asyncio.wait_for(speech_claimed.wait(), timeout=0.4)
        finally:
            await runtime.stop()

    asyncio.run(scenario())


def test_concurrent_completions_coalesce_without_losing_dependent_work():
    from interviews.runtime import RecoveryRuntime

    async def scenario():
        pending = ["turn-a", "turn-b"]
        both_started = asyncio.Event()
        release = asyncio.Event()
        both_speech_claimed = asyncio.Event()
        started = 0
        speech_claims = []
        discoveries = 0

        class Client:
            async def discover(self):
                nonlocal discoveries
                discoveries += 1
                return list(pending)

            async def claim(self, identity):
                pending.remove(identity)
                if identity.startswith("speech"):
                    speech_claims.append(identity)
                    if len(speech_claims) == 2:
                        both_speech_claimed.set()
                return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=120))

            async def heartbeat(self, claim):
                return {}

            async def cleanup(self):
                return {}

        class Executor:
            async def execute(self, claim, **options):
                nonlocal started
                if claim.operation_id.startswith("turn"):
                    started += 1
                    if started == 2:
                        both_started.set()
                    await release.wait()
                    pending.append(claim.operation_id.replace("turn", "speech"))

        runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=1)
        await runtime.start()
        try:
            await asyncio.wait_for(both_started.wait(), timeout=0.2)
            release.set()
            await asyncio.wait_for(both_speech_claimed.wait(), timeout=0.2)
            assert sorted(speech_claims) == ["speech-a", "speech-b"]
            assert discoveries <= 4
        finally:
            await runtime.stop()

    asyncio.run(scenario())


def test_finished_execution_heartbeat_allows_final_usage_receipt_to_complete():
    from interviews.runtime import RecoveryRuntime

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
                # Rails has accepted the result; only the final usage HTTP receipt remains.
                final_usage_started.set()
                await release_usage_response.wait()
                finalized.append(claim.operation_id)

        runtime = RecoveryRuntime(Client(), Executor(), heartbeat_seconds=0.001)
        execution = asyncio.create_task(runtime._run("accepted-turn"))
        try:
            await asyncio.wait_for(final_usage_started.wait(), timeout=1)
            await asyncio.sleep(0.02)
            release_usage_response.set()
            assert await asyncio.wait_for(execution, timeout=1)
            assert finalized == ["accepted-turn"]
            assert heartbeats == ["accepted-turn"]
        finally:
            release_usage_response.set()
            await runtime.stop()
            await asyncio.gather(execution, return_exceptions=True)

    asyncio.run(scenario())
