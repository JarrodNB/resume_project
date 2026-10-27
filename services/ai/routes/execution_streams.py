"""Attach authorized observers; a socket never starts, retries or cancels execution."""

import asyncio
import json
from contextlib import suppress
from datetime import UTC, datetime

from fastapi import WebSocket

from execution.streaming import CURSOR, StreamGap, StreamUnavailable
from schemas.execution_stream import StreamIdentity


async def send(socket, payload, *, timeout=1):
    async with asyncio.timeout(timeout):
        await socket.send_json(payload)


async def relay_output(socket, buffer, owner, *, send_timeout=1):
    tasks = []
    try:
        async with asyncio.timeout(5):
            raw = await socket.receive_text()
        if len(raw.encode()) > 4096:
            raise ValueError("Invalid observer message")
        auth = json.loads(raw)
        if (not isinstance(auth, dict) or set(auth) - {"type", "token", "cursor"}
                or auth.get("type") != "authorize" or not isinstance(auth.get("token"), str)
                or not 40 <= len(auth["token"]) <= 100):
            raise ValueError("Invalid observer capability")
        cursor = auth.get("cursor", "0-0")
        if not isinstance(cursor, str) or not CURSOR.fullmatch(cursor):
            raise ValueError("Invalid cursor")
        grant = await owner("redeem", {"token": auth["token"]})
        identity = StreamIdentity.model_validate({key: grant[key] for key in StreamIdentity.model_fields})
        expires = datetime.fromisoformat(grant["expires_at"])
        if expires.tzinfo is None or expires <= datetime.now(UTC):
            raise ValueError("Expired observer capability")
        await send(socket, {"type": "attached", **identity.model_dump(mode="json")}, timeout=send_timeout)

        async def forward():
            nonlocal cursor
            while True:
                remaining = (expires - datetime.now(UTC)).total_seconds()
                if remaining <= 0:
                    raise ValueError("Expired observer capability")
                events = await buffer.read(identity.model_dump(mode="json"), cursor,
                    block_ms=max(1, min(1000, int(remaining * 1000))))
                # Recheck before private delivery, including after a blocking read.
                checked = await owner("check", {"grant_id": grant["grant_id"]})
                if datetime.now(UTC) >= expires or any(checked.get(key) != grant[key] for key in StreamIdentity.model_fields):
                    raise ValueError("Observer authority changed")
                for event_id, event in events:
                    await send(socket, {"cursor": event_id, **event}, timeout=send_timeout)
                    cursor = event_id
                    if event["type"] in {"completed", "failed", "cancelled", "superseded"}:
                        return

        async def disconnect():
            frame = await socket.receive()
            if frame.get("type") != "websocket.disconnect":
                raise ValueError("Observer sockets accept no execution controls")

        tasks = [asyncio.create_task(forward()), asyncio.create_task(disconnect())]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (StreamGap, StreamUnavailable):
        with suppress(Exception):
            await send(socket, {"type": "reset", "code": "saved_state_required"}, timeout=send_timeout)
    except Exception:
        with suppress(Exception):
            await send(socket, {"type": "error", "code": "stream_unavailable"}, timeout=send_timeout)
    finally:
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        with suppress(Exception):
            await socket.close()


def install_output_stream(app, *, allowed_origins):
    @app.websocket("/ai/executions/stream")
    async def output_stream(socket: WebSocket):
        service = getattr(app.state, "execution_streams", None)
        if socket.headers.get("origin") not in allowed_origins or socket.query_params or service is None:
            await socket.close(code=1008)
            return
        await socket.accept()
        await relay_output(socket, service[0], service[1])
