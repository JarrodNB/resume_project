"""Exercise shared output/replay through actual Redis and authenticated sockets."""
import asyncio
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import pytest
import redis


@pytest.fixture(scope="module")
def redis_url(tmp_path_factory):
    external = os.getenv("AI_TEST_REDIS_URL")
    if external:
        from urllib.parse import urlsplit

        if urlsplit(external).hostname not in {"redis", "127.0.0.1", "localhost", "::1"}:
            raise ValueError("Streaming integration tests require a local Redis service")
        client = redis.Redis.from_url(external, socket_connect_timeout=1, socket_timeout=1)
        client.ping()
        try:
            yield external
        finally:
            client.close()
        return
    executable = os.getenv("REDIS_SERVER") or shutil.which("redis-server")
    if not executable:
        candidate = Path("/workspace/resume_project/.native/bin/redis-server")
        executable = str(candidate) if candidate.is_file() else None
    if not executable:
        pytest.skip("A local Redis server is required for streaming integration checks")
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
    process = subprocess.Popen([executable, "--bind", "127.0.0.1", "--port", str(port),
        "--save", "", "--appendonly", "no"], cwd=tmp_path_factory.mktemp("streams"),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"redis://127.0.0.1:{port}/0"
    client = redis.Redis.from_url(url, socket_connect_timeout=0.1, socket_timeout=0.1)
    try:
        until = time.monotonic() + 5
        while True:
            try:
                client.ping()
                break
            except redis.RedisError:
                if time.monotonic() > until:
                    raise
                time.sleep(0.01)
        yield url
    finally:
        client.close()
        process.terminate()
        process.wait(timeout=5)


def identity():
    return {"feature": "test_stream", "operation_id": str(uuid4()), "attempt_id": str(uuid4()),
            "claim_generation": 1}


def test_output_is_replayed_in_order_by_another_replica(redis_url):
    from execution.streaming import StreamBuffer

    async def scenario():
        producer = StreamBuffer(redis_url)
        observer = StreamBuffer(redis_url)
        metadata = identity()
        sink = producer.sink(**metadata)
        assert await sink.emit("delta", text="Hello ")
        assert await sink.emit("delta", text="world")
        events = await observer.read(metadata, "0-0", block_ms=1)
        assert [event[1]["text"] for event in events] == ["Hello ", "world"]
        assert all(event[1]["attempt_id"] == metadata["attempt_id"] for event in events)
        assert await observer.read(metadata, events[-1][0], block_ms=1) == []
        await producer.close()
        await observer.close()

    asyncio.run(scenario())


def test_invalid_stream_event_disables_the_sink_without_raising():
    from execution.streaming import StreamBuffer

    async def scenario():
        buffer = StreamBuffer("redis://127.0.0.1:1/0")
        sink = buffer.sink(**identity())
        assert not await sink.emit("delta", text="")
        assert not sink.available
        assert not await sink.emit("delta", text="later valid text")
        assert not await sink.emit("bogus_kind")
        await buffer.close()

    asyncio.run(scenario())


def test_socket_attaches_on_another_replica_and_reconnect_never_starts_work(redis_url):
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from execution.runner import ExecutionRunner
    from execution.streaming import StreamBuffer, StreamingOutputs
    from routes.execution_streams import install_output_stream

    metadata = identity()
    expires = (datetime.now(UTC) + timedelta(seconds=30)).isoformat()
    grants = dict(metadata, grant_id=str(uuid4()), expires_at=expires)
    calls = []

    async def owner(action, payload):
        calls.append(action)
        return grants

    class Adapter:
        async def claim(self, operation_id):
            calls.append("claim")
            return SimpleNamespace(**{key: metadata[key] for key in metadata if key != "feature"},
                execution_deadline=datetime.now(UTC) + timedelta(seconds=10))

        async def heartbeat(self, claim):
            return {}

        async def execute(self, claim, output):
            assert output is not None
            await output.emit("started")
            await output.emit("delta", text="streamed text")
            await output.emit("completed")

    async def generate():
        producer = StreamBuffer(redis_url)
        runner = ExecutionRunner({"test_stream": Adapter()},
            output_factory=StreamingOutputs(producer, {"test_stream"}))
        assert await runner.run_once("test_stream", metadata["operation_id"])
        await runner.close()
        await producer.close()

    asyncio.run(generate())
    from contextlib import asynccontextmanager

    observer = StreamBuffer(redis_url)

    @asynccontextmanager
    async def lifespan(app):
        yield
        await observer.close()

    app = FastAPI(lifespan=lifespan)
    app.state.execution_streams = (observer, owner)
    install_output_stream(app, allowed_origins={"http://allowed"})
    with TestClient(app) as client:
        with client.websocket_connect("/ai/executions/stream", headers={"origin": "http://allowed"}) as stream:
            stream.send_json({"type": "authorize", "token": "a" * 43})
            assert stream.receive_json()["type"] == "attached"
            assert stream.receive_json()["type"] == "started"
            delta = stream.receive_json()
            assert delta["text"] == "streamed text"
            assert stream.receive_json()["type"] == "completed"
        with client.websocket_connect("/ai/executions/stream", headers={"origin": "http://allowed"}) as stream:
            stream.send_json({"type": "authorize", "token": "b" * 43, "cursor": delta["cursor"]})
            assert stream.receive_json()["type"] == "attached"
            assert stream.receive_json()["type"] == "completed"
    assert calls.count("claim") == 1


def test_trimmed_history_and_buffer_loss_reset_without_recreating_old_output(redis_url):
    from execution.streaming import StreamBuffer, StreamGap, stream_keys

    async def scenario():
        buffer = StreamBuffer(redis_url, max_events=2)
        metadata = identity()
        sink = buffer.sink(**metadata)
        await sink.emit("delta", text="one")
        first = (await buffer.read(metadata, "0-0", block_ms=1))[0][0]
        await sink.emit("delta", text="two")
        await sink.emit("delta", text="three")
        with pytest.raises(StreamGap):
            await buffer.read(metadata, first, block_ms=1)
        with pytest.raises(StreamGap):
            await buffer.read(metadata, "0-0", block_ms=1)
        _, key = stream_keys(sink.identity)
        await buffer.client.delete(key)
        assert not await sink.emit("delta", text="late")
        assert not await buffer.client.exists(key)
        with pytest.raises(StreamGap):
            await buffer.read(metadata, first, block_ms=1)
        await buffer.close()

    asyncio.run(scenario())


def test_trim_between_preflight_and_blocking_read_returns_a_reset(redis_url):
    from execution.streaming import StreamBuffer, StreamGap

    async def scenario():
        buffer = StreamBuffer(redis_url, max_events=3)
        metadata = identity()
        sink = buffer.sink(**metadata)
        await sink.emit("delta", text="one")
        cursor = (await buffer.read(metadata, "0-0", block_ms=1))[0][0]
        await sink.emit("delta", text="two")
        await sink.emit("delta", text="three")
        original_read = buffer.client.xread

        async def trim_then_read(*args, **kwargs):
            await sink.emit("delta", text="four")
            await sink.emit("delta", text="five")
            return await original_read(*args, **kwargs)

        buffer.client.xread = trim_then_read
        with pytest.raises(StreamGap):
            await buffer.read(metadata, cursor, block_ms=1)
        await buffer.close()

    asyncio.run(scenario())


def test_new_generation_fences_old_writer_and_private_fields_are_rejected(redis_url):
    from pydantic import ValidationError

    from execution.streaming import StreamBuffer, StreamGap

    async def scenario():
        buffer = StreamBuffer(redis_url)
        old = identity()
        first = buffer.sink(**old)
        await first.emit("started")
        newer = {**old, "attempt_id": str(uuid4()), "claim_generation": 2}
        second = buffer.sink(**newer)
        assert await second.emit("delta", text="replacement")
        assert not await first.emit("delta", text="obsolete")
        with pytest.raises(StreamGap):
            await buffer.read(old, "0-0", block_ms=1)
        with pytest.raises(ValidationError):
            await second.emit("delta", text="public", tool_arguments={"secret": "private"})
        with pytest.raises(ValidationError):
            await second.emit("completed", text="unaccepted draft")
        assert [event[1]["text"] for event in await buffer.read(newer, "0-0", block_ms=1)] == ["replacement"]
        await buffer.close()

    asyncio.run(scenario())


def test_optional_stream_outage_cannot_fail_canonical_acceptance_or_enable_interviews():
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace

    from fastapi import FastAPI

    from execution.runner import ExecutionRunner
    from execution.stream_runtime import optional_streaming
    from execution.streaming import StreamBuffer, StreamingOutputs

    async def scenario():
        accepted = []
        metadata = identity()

        class Adapter:
            stream_output = True

            async def claim(self, operation_id):
                return SimpleNamespace(**{key: metadata[key] for key in metadata if key != "feature"},
                    execution_deadline=datetime.now(UTC) + timedelta(seconds=5))

            async def heartbeat(self, claim):
                return {}

            async def execute(self, claim, output):
                assert not await output.emit("delta", text="lost provisional text")
                accepted.append(claim.operation_id)

        buffer = StreamBuffer("redis://127.0.0.1:1/0")
        runner = ExecutionRunner({"test_stream": Adapter()}, output_factory=StreamingOutputs(buffer, {"test_stream"}))
        assert await runner.run_once("test_stream", metadata["operation_id"])
        assert accepted == [metadata["operation_id"]]
        await runner.close()
        await buffer.close()
        interviews = ExecutionRunner({"interviews": Adapter()})
        async with optional_streaming(FastAPI(), interviews, enabled=True, redis_url=None,
                rails_origin="not-an-origin", secret=""):
            assert interviews.output_factory is None
            assert interviews.ready
        await interviews.close()

    asyncio.run(scenario())


def test_socket_denies_query_credentials_and_expired_or_revoked_observers(redis_url):
    from contextlib import asynccontextmanager
    from datetime import UTC, datetime, timedelta

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from execution.streaming import StreamBuffer
    from routes.execution_streams import install_output_stream

    metadata = identity()
    grants = dict(metadata, grant_id=str(uuid4()), expires_at=(datetime.now(UTC) + timedelta(seconds=20)).isoformat())
    observer = StreamBuffer(redis_url)

    async def owner(action, payload):
        if action == "check":
            raise ValueError("revoked")
        return grants

    @asynccontextmanager
    async def lifespan(app):
        sink = observer.sink(**metadata)
        await sink.emit("delta", text="must not be disclosed")
        yield
        await observer.close()

    app = FastAPI(lifespan=lifespan)
    app.state.execution_streams = (observer, owner)
    install_output_stream(app, allowed_origins={"http://allowed"})
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect), client.websocket_connect(
                "/ai/executions/stream?token=forbidden", headers={"origin": "http://allowed"}):
            pass
        with pytest.raises(WebSocketDisconnect), client.websocket_connect(
                "/ai/executions/stream", headers={"origin": "http://wrong"}):
            pass
        with client.websocket_connect("/ai/executions/stream", headers={"origin": "http://allowed"}) as stream:
            stream.send_json({"type": "authorize", "token": "a" * 43})
            assert stream.receive_json()["type"] == "attached"
            assert stream.receive_json() == {"type": "error", "code": "stream_unavailable"}
        grants["expires_at"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
        with client.websocket_connect("/ai/executions/stream", headers={"origin": "http://allowed"}) as stream:
            stream.send_json({"type": "authorize", "token": "a" * 43})
            assert stream.receive_json()["type"] == "error"


def test_slow_observer_is_detached_without_an_execution_control():
    from datetime import UTC, datetime, timedelta

    from routes.execution_streams import relay_output

    async def scenario():
        metadata = identity()
        grants = dict(metadata, grant_id=str(uuid4()), expires_at=(datetime.now(UTC) + timedelta(seconds=10)).isoformat())
        closed = asyncio.Event()

        class Socket:
            async def receive_text(self):
                return '{"type":"authorize","token":"' + "a" * 43 + '"}'

            async def receive(self):
                await asyncio.Event().wait()

            async def send_json(self, payload):
                if payload["type"] != "attached":
                    await asyncio.sleep(10)

            async def close(self):
                closed.set()

        class Buffer:
            async def read(self, *args, **kwargs):
                return [("1-0", {**metadata, "type": "delta", "text": "text"})]

        async def owner(action, payload):
            assert action in {"redeem", "check"}
            return grants

        await asyncio.wait_for(relay_output(Socket(), Buffer(), owner, send_timeout=0.01), 0.2)
        assert closed.is_set()

    asyncio.run(scenario())


def test_streaming_execution_uses_shared_lease_cancellation_and_finalization(redis_url):
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace

    from execution.runner import ExecutionRunner
    from execution.streaming import StreamBuffer, StreamingOutputs

    async def scenario():
        metadata = identity()
        events = []
        finalized = asyncio.Event()

        class Adapter:
            async def claim(self, operation_id):
                events.append("reserved_usage")
                return SimpleNamespace(**{key: metadata[key] for key in metadata if key != "feature"},
                    execution_deadline=datetime.now(UTC) + timedelta(seconds=1))

            async def execute(self, claim, output):
                try:
                    await output.emit("started")
                    await asyncio.Event().wait()
                finally:
                    events.append("finalized_usage")
                    await output.emit("cancelled")
                    finalized.set()

            async def heartbeat(self, claim):
                raise RuntimeError("lease lost")

        buffer = StreamBuffer(redis_url)
        runner = ExecutionRunner({"test_stream": Adapter()}, heartbeat_seconds=0.01,
            output_factory=StreamingOutputs(buffer, {"test_stream"}))
        assert runner.start("test_stream", metadata["operation_id"]) == "received"
        await asyncio.wait_for(finalized.wait(), 1)
        await runner.close()
        output = await buffer.read(metadata, "0-0", block_ms=1)
        assert [event[1]["type"] for event in output] == ["started", "cancelled"]
        assert events == ["reserved_usage", "finalized_usage"]
        await buffer.close()

    asyncio.run(scenario())


@pytest.mark.parametrize("terminal_status", ["accepted", "failed", "expired"])
def test_missing_terminal_buffer_event_restores_the_saved_result(redis_url, terminal_status):
    from contextlib import asynccontextmanager
    from datetime import UTC, datetime, timedelta

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from execution.streaming import StreamBuffer
    from routes.execution_streams import install_output_stream

    metadata = identity()
    grant = dict(metadata, grant_id=str(uuid4()), status=terminal_status,
                 expires_at=(datetime.now(UTC) + timedelta(seconds=20)).isoformat())
    buffer = StreamBuffer(redis_url)

    async def owner(action, payload):
        assert action in {"redeem", "check"}
        return grant

    @asynccontextmanager
    async def lifespan(app):
        await buffer.sink(**metadata).emit("delta", text="public draft")
        yield
        await buffer.close()

    app = FastAPI(lifespan=lifespan)
    app.state.execution_streams = (buffer, owner)
    install_output_stream(app, allowed_origins={"http://allowed"})
    with TestClient(app) as client, client.websocket_connect(
            "/ai/executions/stream", headers={"origin": "http://allowed"}) as stream:
        stream.send_json({"type": "authorize", "token": "a" * 43})
        assert stream.receive_json()["type"] == "attached"
        assert stream.receive_json()["text"] == "public draft"
        assert stream.receive_json() == {"type": "reset", "code": "saved_state_required"}


def test_owner_transport_never_redirects_credentials_and_bounds_callback_bodies():
    import httpx

    from execution.stream_owner import RailsStreamOwner

    async def scenario():
        seen = []

        def respond(request):
            seen.append((str(request.url), request.headers.get("authorization")))
            return httpx.Response(302, headers={"Location": "https://untrusted.example"})

        owner = RailsStreamOwner("http://rails", "service-secret", transport=httpx.MockTransport(respond))
        with pytest.raises(ValueError):
            await owner("redeem", {"token": "a" * 43})
        assert seen == [("http://rails/internal/execution_streams/redeem", "Bearer service-secret")]
        await owner.close()
        oversized = RailsStreamOwner("http://rails", "service-secret",
            transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"x" * 4097)))
        with pytest.raises(ValueError):
            await oversized("check", {"grant_id": str(uuid4())})
        await oversized.close()
        with pytest.raises(ValueError):
            RailsStreamOwner("http://user:secret@rails", "service-secret")

    asyncio.run(scenario())


def test_expiring_authority_is_rechecked_after_a_blocking_read():
    from datetime import UTC, datetime, timedelta

    from routes.execution_streams import relay_output

    async def scenario():
        metadata = identity()
        grant = dict(metadata, grant_id=str(uuid4()),
            expires_at=(datetime.now(UTC) + timedelta(milliseconds=50)).isoformat())
        sent = []

        class Socket:
            async def receive_text(self):
                return '{"type":"authorize","token":"' + "a" * 43 + '"}'

            async def receive(self):
                await asyncio.Event().wait()

            async def send_json(self, payload):
                sent.append(payload)

            async def close(self):
                pass

        class Buffer:
            async def read(self, *args, **kwargs):
                await asyncio.sleep(0.08)
                return [("1-0", {**metadata, "type": "delta", "text": "must stay private"})]

        async def owner(action, payload):
            return grant

        await asyncio.wait_for(relay_output(Socket(), Buffer(), owner), 1)
        assert [event["type"] for event in sent] == ["attached", "error"]

    asyncio.run(scenario())


def test_read_authority_uses_bounded_leases_instead_of_one_transaction_per_token():
    from datetime import UTC, datetime, timedelta

    from routes.execution_streams import relay_output

    async def scenario(revoke):
        metadata = identity()
        grant = dict(metadata, grant_id=str(uuid4()),
            expires_at=(datetime.now(UTC) + timedelta(seconds=10)).isoformat())
        sent = []
        checks = []
        is_revoked = False

        class Socket:
            async def receive_text(self):
                return '{"type":"authorize","token":"' + "a" * 43 + '"}'

            async def receive(self):
                await asyncio.Event().wait()

            async def send_json(self, payload):
                nonlocal is_revoked
                sent.append(payload)
                if revoke and payload["type"] == "delta":
                    is_revoked = True

            async def close(self):
                pass

        class Buffer:
            count = 0

            async def read(self, *args, **kwargs):
                self.count += 1
                if revoke and self.count == 2:
                    await asyncio.sleep(0.02)
                event = {**metadata, "type": "completed" if self.count == 5 else "delta"}
                if event["type"] == "delta":
                    event["text"] = "public"
                return [(f"{self.count}-0", event)]

        async def owner(action, payload):
            if action == "check":
                checks.append(action)
                if is_revoked:
                    raise ValueError("revoked")
            return grant

        await asyncio.wait_for(relay_output(Socket(), Buffer(), owner,
            authorization_seconds=0.01 if revoke else 1), 1)
        if revoke:
            assert [event["type"] for event in sent] == ["attached", "delta", "error"]
            assert len(checks) == 2
        else:
            assert len(checks) == 1
            assert [event["type"] for event in sent] == ["attached", *["delta"] * 4, "completed"]

    asyncio.run(scenario(False))
    asyncio.run(scenario(True))


def test_slow_batch_cannot_outlive_its_authorization_lease():
    from datetime import UTC, datetime, timedelta

    from routes.execution_streams import relay_output

    async def scenario():
        metadata = identity()
        grant = dict(metadata, grant_id=str(uuid4()),
            expires_at=(datetime.now(UTC) + timedelta(seconds=10)).isoformat())
        sent = []
        revoked = False

        class Socket:
            async def receive_text(self):
                return '{"type":"authorize","token":"' + "a" * 43 + '"}'

            async def receive(self):
                await asyncio.Event().wait()

            async def send_json(self, payload):
                nonlocal revoked
                sent.append(payload)
                if payload["type"] == "delta":
                    revoked = True
                    await asyncio.sleep(0.02)

            async def close(self):
                pass

        class Buffer:
            async def read(self, *args, **kwargs):
                return [("1-0", {**metadata, "type": "delta", "text": "public"}),
                        ("2-0", {**metadata, "type": "delta", "text": "must not be sent"}),
                        ("3-0", {**metadata, "type": "completed"})]

        async def owner(action, payload):
            if action == "check" and revoked:
                raise ValueError("revoked")
            return grant

        await asyncio.wait_for(relay_output(Socket(), Buffer(), owner, authorization_seconds=0.01), 1)
        assert [event["type"] for event in sent] == ["attached", "delta", "error"]

    asyncio.run(scenario())


def test_capability_expiry_bounds_a_pending_send_inside_a_replay_batch():
    from datetime import UTC, datetime, timedelta

    from routes.execution_streams import relay_output

    async def scenario():
        metadata = identity()
        grant = dict(metadata, grant_id=str(uuid4()),
            expires_at=(datetime.now(UTC) + timedelta(milliseconds=100)).isoformat())
        sent = []
        completed_sends = []

        class Socket:
            async def receive_text(self):
                return '{"type":"authorize","token":"' + "a" * 43 + '"}'

            async def receive(self):
                await asyncio.Event().wait()

            async def send_json(self, payload):
                sent.append(payload)
                if payload["type"] == "delta":
                    await asyncio.sleep(0.06)
                    completed_sends.append(payload)

            async def close(self):
                pass

        class Buffer:
            async def read(self, *args, **kwargs):
                return [(f"{number}-0", {**metadata, "type": "delta", "text": "public"})
                        for number in range(1, 10)]

        async def owner(action, payload):
            return grant

        await asyncio.wait_for(relay_output(Socket(), Buffer(), owner), 0.5)
        kinds = [event["type"] for event in sent]
        assert kinds[0] == "attached" and kinds[-1] == "error"
        assert 0 < kinds.count("delta") < 9
        assert len(completed_sends) < kinds.count("delta")

    asyncio.run(scenario())


def test_partial_marker_loss_cannot_resurrect_an_initialized_writer(redis_url):
    from execution.streaming import StreamBuffer, StreamGap, stream_keys

    async def scenario():
        buffer = StreamBuffer(redis_url)
        metadata = identity()
        sink = buffer.sink(**metadata)
        await sink.emit("delta", text="before state loss")
        current, _ = stream_keys(sink.identity)
        await buffer.client.delete(current)
        assert not await sink.emit("delta", text="must not resurrect")
        assert not await buffer.client.exists(current)
        with pytest.raises(StreamGap):
            await buffer.read(metadata, "0-0", block_ms=1)
        await buffer.close()

    asyncio.run(scenario())


def test_closed_output_buffer_cannot_reopen_connections_from_a_late_tail(redis_url):
    from execution.streaming import StreamBuffer

    async def scenario():
        buffer = StreamBuffer(redis_url)
        sink = buffer.sink(**identity())
        await sink.emit("started")
        await buffer.close()
        assert not await sink.emit("delta", text="late finalizer")

    asyncio.run(scenario())
