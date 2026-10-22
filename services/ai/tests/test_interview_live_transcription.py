"""Exercise one live answer using injected browser, owner and provider transports."""
import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from interviews.live_transcription import duration_usage, install_streaming, relay_transcription

AUDIO = b"\0\0" * 2400
AUTH = {"text": '{"type":"authorize","token":"opaque"}'}
COMMIT = {"text": '{"type":"commit"}'}


class Browser:
    def __init__(self, frames):
        self.frames = list(frames)
        self.events = []
        self.closed = False

    async def receive(self):
        if not self.frames:
            await asyncio.Future()
        return self.frames.pop(0)

    async def send_json(self, value):
        self.events.append(value)

    async def close(self):
        self.closed = True


class Owner:
    def __init__(self, *, deny=False):
        self.calls = []
        self.deny = deny

    async def request(self, action, payload):
        if action == "finish":
            assert not any(event["type"] == "final" for event in self.browser.events)
        self.calls.append((action, payload))
        if self.deny:
            raise ValueError("denied")
        return {"capture_id": "owned", "expires_at": "2099-01-01T00:00:00Z"}


class Provider:
    def __init__(self, *, completion=None, hold=False):
        self.events = asyncio.Queue()
        self.events.put_nowait({"type": "session.updated", "session": {"type": "transcription"}})
        self.sent = []
        self.closed = False
        self.hold = hold
        self.completion = completion or {
            "type": "conversation.item.input_audio_transcription.completed", "item_id": "answer",
            "transcript": "My answer", "usage": {"type": "duration", "seconds": 0.1},
        }

    async def send(self, data):
        message = json.loads(data)
        self.sent.append(message)
        if message["type"] == "input_audio_buffer.append":
            self.events.put_nowait({"type": "conversation.item.input_audio_transcription.delta", "item_id": "answer", "delta": "My"})
        elif message["type"] == "input_audio_buffer.commit" and not self.hold:
            self.events.put_nowait({"type": "input_audio_buffer.committed", "item_id": "answer"})
            self.events.put_nowait(self.completion)

    async def recv(self):
        return json.dumps(await self.events.get())

    async def close(self):
        self.closed = True


def run_relay(frames, *, completion=None, deny=False, hold=False):
    browser, owner = Browser(frames), Owner(deny=deny)
    owner.browser = browser
    provider = None

    async def connect():
        nonlocal provider
        provider = Provider(completion=completion, hold=hold)
        return provider

    async def run():
        await asyncio.wait_for(relay_transcription(browser, owner, connect), timeout=0.5)

    asyncio.run(run())
    return browser, owner, provider


def test_live_answer_commits_once_and_saves_before_final():
    browser, owner, provider = run_relay([AUTH, {"bytes": AUDIO}, COMMIT])
    assert browser.events[-1] == {"type": "final", "text": "My answer", "captureId": "owned"}
    assert owner.calls[-1] == ("finish", {"capture_id": "owned", "transcript": "My answer", "usage": {"audio_milliseconds": 100, "cost_microdollars": 29}})
    assert sum(message["type"] == "input_audio_buffer.commit" for message in provider.sent) == 1
    assert provider.closed and browser.closed


def test_disconnect_after_commit_cancels_without_accepting_late_text():
    browser, owner, provider = run_relay([AUTH, {"bytes": AUDIO}, COMMIT, {"type": "websocket.disconnect"}], hold=True)
    assert [action for action, _ in owner.calls] == ["redeem", "fail"]
    assert provider.closed and browser.closed


@pytest.mark.parametrize("frames", [
    [AUTH, {"bytes": b"x"}],
    [AUTH, {"bytes": b"x" * 32770}],
    [AUTH, COMMIT],
    [AUTH, {"bytes": AUDIO}, COMMIT, COMMIT],
    [AUTH, {"bytes": AUDIO}, COMMIT, {"bytes": AUDIO}],
    [AUTH, {"text": '{"type":"cancel"}'}],
])
def test_invalid_or_cancelled_capture_keeps_unknown_cost_and_never_finishes(frames):
    browser, owner, provider = run_relay(frames, hold=True)
    assert [action for action, _ in owner.calls] == ["redeem", "fail"]
    assert owner.calls[-1][1]["usage"] is None
    assert browser.events[-1]["type"] == "error"
    assert provider.closed


def test_owner_denial_never_opens_provider_connection():
    browser, owner, provider = run_relay([AUTH], deny=True)
    assert provider is None
    assert len(owner.calls) == 1
    assert browser.events[-1]["type"] == "error"


def test_wrong_committed_item_rejects_text_but_preserves_actual_receipt():
    browser, owner, _ = run_relay([AUTH, {"bytes": AUDIO}, COMMIT], completion={
        "type": "conversation.item.input_audio_transcription.completed", "item_id": "another",
        "transcript": "Other answer", "usage": {"type": "duration", "seconds": 1},
    })
    assert [action for action, _ in owner.calls] == ["redeem", "fail"]
    assert owner.calls[-1][1]["usage"]["cost_microdollars"] == 284
    assert browser.events[-1]["type"] == "error"


@pytest.mark.parametrize("usage", [None, {"type": "tokens"}, {"type": "duration", "seconds": True}, {"type": "duration", "seconds": float("nan")}, {"type": "duration", "seconds": 121}])
def test_missing_or_invalid_duration_is_unknown(usage):
    assert duration_usage(usage) is None


def test_socket_route_rejects_foreign_origin_before_auth_or_provider_work():
    app = FastAPI()
    app.state.capture_owner = Owner()
    install_streaming(app, allowed_origins={"http://allowed"}, api_key="not-sent")
    with (TestClient(app) as client, pytest.raises(WebSocketDisconnect) as error,
          client.websocket_connect("/interview-transcription/stream", headers={"origin": "http://foreign"})):
        pass
    assert error.value.code == 1008
    assert app.state.capture_owner.calls == []
