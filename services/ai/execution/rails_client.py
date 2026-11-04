"""Send fixed-origin Rails execution callbacks with bounded requests and retries.

Chat and interview adapters own their claim and acceptance contracts. This module
owns credentials, byte limits, deadlines and the shared lease/accounting callbacks.
"""
import asyncio
import json
from typing import Any
from urllib.parse import quote, urlsplit

import httpx


class RailsClientError(RuntimeError):
    """Rails rejected a request; response bodies may contain private data."""

    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Rails interview request failed ({status_code})")


class RailsTransportError(RuntimeError):
    """No trustworthy receipt arrived; reconcile status before further work."""


class RailsExecutionClient:
    """Share transport and execution callbacks without domain-specific operations."""

    def __init__(self, origin: str, secret: str, *, transport=None, max_body_bytes=512_000,
                 namespace="interviews"):
        if namespace not in {"interviews", "chat"}:
            raise ValueError("Unknown execution namespace")
        self._namespace = namespace
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Rails origin must be an HTTP origin")
        if not secret or any(c in secret for c in "\r\n"):
            raise ValueError("Service secret is required")
        if not 1024 <= max_body_bytes <= 1_048_576:
            raise ValueError("Invalid response size limit")
        self._origin = origin.rstrip("/")
        self._limit = max_body_bytes
        self._client = httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(10, connect=3),
            follow_redirects=False,
            trust_env=False,
            headers={"Authorization": f"Bearer {secret}", "Accept": "application/json"},
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.aclose()

    async def aclose(self):
        await self._client.aclose()

    async def _request(self, method, path, payload=None, *, retry=True, allow_boolean=False):
        # A total deadline also bounds a server that trickles bytes indefinitely.
        try:
            async with asyncio.timeout(25):
                return await self._bounded_request(
                    method, path, payload, retry=retry, allow_boolean=allow_boolean
                )
        except TimeoutError:
            raise RailsTransportError("Rails request deadline exceeded") from None

    async def _bounded_request(
        self, method, path, payload=None, *, retry=True, allow_boolean=False
    ):
        body = (
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
            if payload is not None
            else None
        )
        if body and len(body) > self._limit:
            raise RailsTransportError("Rails request exceeds size limit")
        for attempt in range(2 if retry else 1):
            try:
                async with self._client.stream(
                    method,
                    self._origin + "/internal/" + self._namespace + "/" + path,
                    content=body,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > self._limit:
                            raise RailsTransportError("Rails response exceeds size limit")
                    if response.status_code == 503 and retry and attempt == 0:
                        continue
                    if response.status_code != 200:
                        raise RailsClientError(response.status_code)
                    result = json.loads(chunks)
                    if not isinstance(result, dict) and not (
                        allow_boolean and isinstance(result, bool)
                    ):
                        raise RailsTransportError("Invalid Rails receipt")
                    return result
            except httpx.TransportError:
                if not retry or attempt:
                    raise RailsTransportError("Rails receipt unavailable") from None
            except (ValueError, UnicodeError):
                raise RailsTransportError("Invalid Rails receipt") from None
        raise RailsTransportError("Rails receipt unavailable")

    @staticmethod
    def _path(operation_id, action=""):
        return "operations/" + quote(str(operation_id), safe="") + ("/" + action if action else "")

    async def _callback(self, claim, action, **values):
        return await self._request(
            "POST",
            self._path(claim.operation_id, action),
            {**claim.identity(), **values},
            allow_boolean=action == "usage",
        )

    async def heartbeat(self, claim, checkpoint: str | None = None):
        return await self._callback(claim, "heartbeat", checkpoint=checkpoint)

    async def fail(self, claim, code: str, retryable: bool):
        return await self._callback(claim, "fail", code=code, retryable=retryable)

    async def start_provider(
        self, claim, observation_id: str, stage: str, provider: str, model: str
    ):
        result = await self._callback(
            claim,
            "start_provider",
            observation_id=observation_id,
            stage=stage,
            provider=provider,
            model=model,
        )
        if result.get("observation_id") != observation_id:
            raise RailsTransportError("Invalid provider admission receipt")
        return result

    async def usage(
        self,
        claim,
        usage: list[dict[str, Any]],
        *,
        incomplete=False,
        observation_id: str | None = None,
    ):
        return await self._callback(
            claim, "usage", usage=usage, incomplete=incomplete, observation_id=observation_id
        )
