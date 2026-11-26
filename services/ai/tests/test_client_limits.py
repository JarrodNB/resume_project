"""One client address cannot hold many not-yet-signed-in sockets or keep sending wrong tokens."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from interviews.live_transcription import install_streaming
from routes.client_limits import REFUSED_CLOSE_CODE, ClientLimits, client_key
from routes.execution_streams import install_output_stream


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class FakeSocket:
    def __init__(self, headers=None, host="10.0.0.9"):
        self.headers = headers or {}
        self.client = type("Client", (), {"host": host})() if host else None


def test_pending_sockets_per_client_are_capped_and_freed_when_they_end():
    limits = ClientLimits(max_pending=2)
    first, second = limits.admit("a"), limits.admit("a")

    assert first and second
    assert limits.admit("a") is None
    assert limits.admit("b") is not None  # another client is unaffected
    first.authorized()  # signing in frees the slot without counting a failure
    third = limits.admit("a")
    assert third is not None
    first.close()
    second.close()
    third.close()


def test_a_client_with_too_many_failed_sign_ins_is_refused_until_the_minute_passes():
    clock = FakeClock()
    limits = ClientLimits(max_failures=3, window_seconds=60, clock=clock)
    for _ in range(3):
        limits.admit("a").close()  # ended without signing in

    assert limits.admit("a") is None
    clock.now += 61

    assert limits.admit("a") is not None


def test_signed_in_sockets_are_never_counted_as_failures():
    limits = ClientLimits(max_pending=1, max_failures=1)
    for _ in range(5):
        ticket = limits.admit("a")
        ticket.authorized()
        ticket.close()

    assert limits.admit("a") is not None


def test_idle_clients_are_forgotten():
    limits = ClientLimits(max_pending=1, max_failures=1)
    limits.admit("a").close()
    limits.admit("b").authorized()
    limits.admit("c")  # still pending

    assert "a" in limits._failures and "b" not in limits._pending
    assert "c" in limits._pending


def test_client_key_prefers_the_first_forwarded_address():
    assert client_key(FakeSocket({"x-forwarded-for": "203.0.113.7, 10.0.0.2"})) == "203.0.113.7"
    assert client_key(FakeSocket({})) == "10.0.0.9"
    assert client_key(FakeSocket({}, host=None)) == "unknown"


class RefusingOwner:
    def __init__(self):
        self.calls = 0

    async def __call__(self, action, payload):
        self.calls += 1
        raise ValueError("not a real token")

    async def request(self, action, payload):
        return await self(action, payload)


def connect(client, path):
    return client.websocket_connect(path, headers={"origin": "http://allowed", "x-forwarded-for": "203.0.113.7"})


@pytest.mark.parametrize("path", ["/ai/executions/stream", "/interview-transcription/stream"])
def test_wrong_tokens_stop_reaching_rails_after_the_failure_limit(path):
    owner = RefusingOwner()
    app = FastAPI()
    app.state.execution_streams = (object(), owner)
    app.state.capture_owner = owner
    limits = ClientLimits(max_failures=3)
    install_output_stream(app, allowed_origins={"http://allowed"}, limits=limits)
    install_streaming(app, allowed_origins={"http://allowed"}, api_key="not-sent", limits=limits)

    with TestClient(app) as client:
        for _ in range(3):
            with connect(client, path) as socket:
                socket.send_json({"type": "authorize", "token": "a" * 43})
                socket.receive_json()
        calls_before = owner.calls
        with pytest.raises(WebSocketDisconnect) as refused, connect(client, path):
            pass

    assert refused.value.code == REFUSED_CLOSE_CODE
    assert owner.calls == calls_before == 3  # the refused socket never reached Rails
