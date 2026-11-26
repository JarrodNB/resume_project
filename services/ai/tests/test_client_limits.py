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
    limits.admit("b").authorized()
    limits.admit("c")  # still pending

    assert "b" not in limits._pending and "c" in limits._pending


def test_quiet_addresses_are_dropped_by_the_sweep_so_the_table_cannot_grow_forever(monkeypatch):
    monkeypatch.setattr("routes.client_limits.SWEEP_EVERY_ADMITS", 4)
    clock = FakeClock()
    limits = ClientLimits(window_seconds=60, clock=clock)
    for number in range(10):
        limits.admit(f"198.51.100.{number}").close()
    assert len(limits._failures) == 10
    clock.now += 61

    for _ in range(4):
        limits.admit("203.0.113.1").authorized()

    assert not limits._failures


def test_past_the_tracking_limit_new_addresses_share_one_budget():
    limits = ClientLimits(max_failures=2, max_tracked=3)
    for number in range(3):
        limits.admit(f"198.51.100.{number}").close()  # three tracked addresses

    limits.admit("203.0.113.1").close()
    limits.admit("203.0.113.2").close()  # different new addresses, one shared budget now used up

    assert limits.admit("203.0.113.3") is None
    assert limits.admit("198.51.100.0") is not None  # an already tracked address keeps its own budget


def test_a_full_table_drops_quiet_addresses_before_sharing_a_budget():
    clock = FakeClock()
    limits = ClientLimits(max_failures=1, max_tracked=3, window_seconds=60, clock=clock)
    for number in range(3):
        limits.admit(f"198.51.100.{number}").close()
    clock.now += 61  # all three have gone quiet

    ticket = limits.admit("203.0.113.1")
    ticket.close()

    assert limits.admit("203.0.113.1") is None  # its own failure counts; it was not sent to the shared bucket
    assert limits.admit("203.0.113.9") is not None  # another new address still has its own budget


def test_flooding_the_shared_bucket_cannot_reset_a_tracked_clients_budget():
    limits = ClientLimits(max_failures=1, max_tracked=2)
    limits.admit("198.51.100.1").close()  # tracked and at its limit
    limits.admit("198.51.100.2").close()
    for number in range(20):
        limits.admit(f"203.0.113.{number}")  # a flood of new addresses

    assert limits.admit("198.51.100.1") is None


def test_ticket_calls_are_safe_to_repeat():
    limits = ClientLimits(max_pending=1)
    ticket = limits.admit("a")
    ticket.authorized()
    ticket.authorized()
    ticket.close()
    ticket.close()

    assert limits._pending.get("a", 0) == 0
    assert limits.admit("a") is not None


def test_client_key_prefers_the_first_forwarded_address():
    assert client_key(FakeSocket({"x-forwarded-for": "203.0.113.7, 10.0.0.2"})) == "203.0.113.7"
    assert client_key(FakeSocket({})) == "10.0.0.9"
    assert client_key(FakeSocket({}, host=None)) == "invalid"


def test_ipv6_addresses_count_as_their_whole_64_and_garbage_shares_one_bucket():
    first = client_key(FakeSocket({"x-forwarded-for": "2001:db8:1:2::1"}))
    other = client_key(FakeSocket({"x-forwarded-for": "2001:db8:1:2:ffff:ffff:ffff:ffff"}))
    assert first == other == "2001:db8:1:2::/64"
    assert client_key(FakeSocket({"x-forwarded-for": "2001:db8:1:3::1"})) != first
    assert client_key(FakeSocket({"x-forwarded-for": "::ffff:203.0.113.7"})) == "203.0.113.7"
    for garbage in ["not an address", "a" * 5000, "<script>"]:
        assert client_key(FakeSocket({"x-forwarded-for": garbage})) == "invalid"


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


def test_a_socket_that_disconnects_before_sending_a_token_releases_its_slot():
    owner = RefusingOwner()
    app = FastAPI()
    app.state.capture_owner = owner
    limits = ClientLimits(max_pending=1)
    install_streaming(app, allowed_origins={"http://allowed"}, api_key="not-sent", limits=limits)

    with TestClient(app) as client, connect(client, "/interview-transcription/stream"):
        pass  # disconnects without sending a token

    assert limits._pending.get("203.0.113.7", 0) == 0


def test_both_endpoints_draw_on_one_budget():
    owner = RefusingOwner()
    app = FastAPI()
    app.state.execution_streams = (object(), owner)
    app.state.capture_owner = owner
    limits = ClientLimits(max_failures=2)
    install_output_stream(app, allowed_origins={"http://allowed"}, limits=limits)
    install_streaming(app, allowed_origins={"http://allowed"}, api_key="not-sent", limits=limits)

    with TestClient(app) as client:
        with connect(client, "/ai/executions/stream") as socket:
            socket.send_json({"type": "authorize", "token": "a" * 43})
            socket.receive_json()
        with connect(client, "/interview-transcription/stream") as socket:
            socket.send_json({"type": "authorize", "token": "a" * 43})
            socket.receive_json()
        with pytest.raises(WebSocketDisconnect), connect(client, "/ai/executions/stream"):
            pass
        with pytest.raises(WebSocketDisconnect), connect(client, "/interview-transcription/stream"):
            pass
