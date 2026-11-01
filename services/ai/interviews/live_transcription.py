"""Relay one bounded microphone answer through a Rails-admitted provider connection.

Only PCM16 audio and commit/cancel controls cross the browser socket. The provider
key stays here; final text is persisted by Rails before it becomes usable input.
"""
import asyncio
import base64
import json
import math
import time
from contextlib import ExitStack, suppress
from datetime import UTC, datetime
from decimal import ROUND_CEILING, Decimal

import logfire

MODEL = "gpt-live-transcribe"
MAX_AUDIO_BYTES = 24_000 * 2 * 120
MAX_FRAME_BYTES = 32_768
MAX_TEXT = 4_000
SESSION_UPDATE = {
    "type": "session.update",
    "session": {"type": "transcription", "audio": {"input": {
        "format": {"type": "audio/pcm", "rate": 24_000},
        "transcription": {"model": MODEL}, "turn_detection": None,
    }}},
}


class CaptureOwner:
    """Reuse the bounded fixed-origin internal Rails transport for capture callbacks."""

    def __init__(self, rails):
        self._rails = rails

    async def request(self, action, payload):
        return await self._rails.transcription_capture(action, payload)


def duration_usage(value):
    """Price an actual provider duration receipt; absent/token usage stays unknown."""
    if not isinstance(value, dict) or value.get("type") != "duration":
        return None
    seconds = value.get("seconds")
    if (isinstance(seconds, bool) or not isinstance(seconds, (int, float))
            or not math.isfinite(seconds) or not 0 < seconds <= 120):
        return None
    duration = Decimal(str(seconds))
    return {
        "audio_milliseconds": int((duration * 1000).to_integral_value(rounding=ROUND_CEILING)),
        "cost_microdollars": int((duration * Decimal(17000) / 60).to_integral_value(rounding=ROUND_CEILING)),
    }


def message_json(value):
    if not isinstance(value, str) or len(value) > 64_000:
        raise ValueError("invalid_message")
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise TypeError("invalid_message")
    return parsed


async def relay_transcription(browser, owner, connect):
    """Handle a single one-use capability, with no automatic provider reconnects."""
    capture_id = None
    usage = None
    persisted = False
    provider = None
    tasks = []
    traces = ExitStack()
    trace = traces.enter_context(logfire.span("interview.transcription.stream", provider="openai", model=MODEL))
    started = time.monotonic()
    committed_at = None
    total_bytes = 0
    ready = False
    committed = asyncio.Event()
    outcome = "internal_error"
    phase = "authorization"
    try:
        async with asyncio.timeout(150):
            async with asyncio.timeout(5):
                first = await browser.receive()
            auth = message_json(first.get("text"))
            if auth.get("type") != "authorize" or not isinstance(auth.get("token"), str):
                raise ValueError("invalid_authorization")
            grant = await owner.request("redeem", {"token": auth["token"]})
            capture_id = grant["capture_id"]
            trace.set_attribute("capture_id", capture_id)
            if grant.get("observation_id") is not None:
                trace.set_attribute("observation_id", grant["observation_id"])
            expiry = datetime.fromisoformat(grant["expires_at"])
            remaining = min(145, (expiry - datetime.now(UTC)).total_seconds())
            if remaining <= 0:
                raise ValueError("capture_expired")
            async with asyncio.timeout(remaining):
                phase = "provider_setup"
                # Admission and its unknown-usage marker are durable before connect().
                async with asyncio.timeout(10):
                    provider = await connect()
                    await provider.send(json.dumps(SESSION_UPDATE))
                    for _ in range(8):
                        event = message_json(await provider.recv())
                        if event.get("type") == "session.updated":
                            if event.get("session", {}).get("type") != "transcription":
                                raise ValueError("invalid_session")
                            break
                        if event.get("type") != "session.created":
                            raise ValueError("provider_setup_failed")
                    else:
                        raise ValueError("provider_setup_failed")
                await browser.send_json({"type": "ready"})
                ready = True
                trace.set_attribute("provider_ready_seconds", time.monotonic() - started)
                phase = "streaming"
                completed = asyncio.Event()
                item_id = None
                partials = {}

                async def from_browser():
                    nonlocal total_bytes, committed_at
                    while True:
                        frame = await browser.receive()
                        if frame.get("type") == "websocket.disconnect":
                            raise ValueError("capture_disconnected")
                        data = frame.get("bytes")
                        if data is not None:
                            if committed.is_set():
                                raise ValueError("audio_after_commit")
                            if not data or len(data) > MAX_FRAME_BYTES or len(data) % 2:
                                raise ValueError("invalid_audio_frame")
                            total_bytes += len(data)
                            if total_bytes > MAX_AUDIO_BYTES:
                                raise ValueError("audio_too_long")
                            await provider.send(json.dumps({"type": "input_audio_buffer.append",
                                "audio": base64.b64encode(data).decode("ascii")}))
                            continue
                        control = message_json(frame.get("text"))
                        if control.get("type") != "commit" or committed.is_set() or total_bytes < 4_800:
                            raise ValueError("capture_cancelled")
                        committed.set()
                        committed_at = time.monotonic()
                        await provider.send(json.dumps({"type": "input_audio_buffer.commit"}))

                async def from_provider():
                    nonlocal item_id, usage, persisted
                    while True:
                        event = message_json(await provider.recv())
                        kind = event.get("type")
                        if kind == "input_audio_buffer.committed":
                            if not committed.is_set() or item_id is not None:
                                raise ValueError("invalid_commit")
                            item_id = event.get("item_id")
                            if not isinstance(item_id, str) or not item_id:
                                raise ValueError("invalid_commit")
                        elif kind == "conversation.item.input_audio_transcription.delta":
                            identity, delta = event.get("item_id"), event.get("delta")
                            if not isinstance(identity, str) or not isinstance(delta, str):
                                raise ValueError("invalid_transcript")
                            if len(partials) > 1 or len(partials.get(identity, "")) + len(delta) > MAX_TEXT:
                                raise ValueError("transcript_too_long")
                            partials[identity] = partials.get(identity, "") + delta
                            await browser.send_json({"type": "partial", "text": partials[identity]})
                        elif kind == "conversation.item.input_audio_transcription.completed":
                            # Preserve a real receipt even if final text is unusable.
                            usage = duration_usage(event.get("usage"))
                            text = event.get("transcript")
                            if (not committed.is_set() or item_id is None or event.get("item_id") != item_id
                                    or not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT):
                                raise ValueError("invalid_transcript")
                            if committed_at is not None:
                                trace.set_attribute("commit_to_transcript_seconds", time.monotonic() - committed_at)
                            await owner.request("finish", {"capture_id": capture_id,
                                "transcript": text, "usage": usage})
                            persisted = True
                            await browser.send_json({"type": "final", "text": text, "captureId": capture_id})
                            completed.set()
                            return
                        elif kind in {"error", "conversation.item.input_audio_transcription.failed"}:
                            raise ValueError("provider_failed")

                async def finalization_deadline():
                    async with asyncio.timeout(120):
                        await committed.wait()
                    async with asyncio.timeout(10):
                        await completed.wait()

                tasks = [asyncio.create_task(work()) for work in
                         (from_browser, from_provider, finalization_deadline)]
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
                outcome = "completed" if persisted else "internal_error"
    except Exception as exc:  # noqa: BLE001 - relay failures must leave the saved recording usable
        safe_reasons = {
            "capture_disconnected": "browser_disconnected", "capture_cancelled": "cancelled",
            "provider_failed": "provider_failed", "provider_setup_failed": "provider_setup_failed",
            "invalid_session": "provider_setup_failed", "invalid_transcript": "invalid_transcript",
            "transcript_too_long": "invalid_transcript", "invalid_authorization": "invalid_authorization",
            "capture_expired": "capture_expired", "invalid_audio_frame": "invalid_audio",
            "audio_too_long": "invalid_audio", "audio_after_commit": "invalid_audio",
            "invalid_commit": "invalid_commit",
        }
        if isinstance(exc, TimeoutError):
            outcome = "timeout"
        elif isinstance(exc, ValueError) and str(exc) in safe_reasons:
            outcome = safe_reasons[str(exc)]
        else:
            outcome = "internal_error"
        # Neither tokens, provider messages nor candidate text enter error diagnostics.
        with suppress(Exception):
            await browser.send_json({"type": "error", "code": "transcription_unavailable"})
    finally:
        # Close without raw exception details: socket reasons may contain private payloads.
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if capture_id and not persisted:
            # A failed callback retains Rails' unknown reservation for reconciliation.
            try:
                async with asyncio.timeout(25):
                    await owner.request("fail", {"capture_id": capture_id, "usage": usage})
                trace.set_attribute("failure_callback", "completed")
            except Exception:  # noqa: BLE001 - preserve unknown reservation for reconciliation
                trace.set_attribute("failure_callback", "failed")
        trace.set_attribute("outcome", outcome)
        trace.set_attribute("phase", phase)
        trace.set_attribute("provider_ready", ready)
        trace.set_attribute("audio_committed", committed.is_set())
        trace.set_attribute("transcript_persisted", persisted)
        trace.set_attribute("audio_milliseconds", total_bytes * 1000 / 48_000)
        if usage is not None:
            trace.set_attribute("provider_audio_milliseconds", usage["audio_milliseconds"])
            trace.set_attribute("provider_cost_microdollars", usage["cost_microdollars"])
        traces.close()
        if provider is not None:
            with suppress(Exception):
                async with asyncio.timeout(3):
                    await provider.close()
        with suppress(Exception):
            await browser.close()


def install_streaming(app, *, allowed_origins, api_key):
    """Install a browser relay with exact origin checks and a fixed provider endpoint."""
    from fastapi import WebSocket

    @app.websocket("/interview-transcription/stream")
    async def transcription_stream(socket: WebSocket):
        if socket.headers.get("origin") not in allowed_origins or not getattr(app.state, "capture_owner", None):
            await socket.close(code=1008)
            return
        await socket.accept()

        async def connect():
            from websockets.asyncio.client import connect as websocket_connect
            return await websocket_connect(
                "wss://api.openai.com/v1/realtime?intent=transcription",
                additional_headers={"Authorization": f"Bearer {api_key}"},
                open_timeout=8, close_timeout=2, max_size=64_000, max_queue=8,
                proxy=None,
            )

        await relay_transcription(socket, app.state.capture_owner, connect)
