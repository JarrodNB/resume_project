"""Validate observer grants only with the configured Rails origin."""

import asyncio
import json
from urllib.parse import urlsplit

import httpx


class RailsStreamOwner:
    def __init__(self, origin, secret, *, transport=None):
        parsed = urlsplit(origin)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username
                or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
                or not secret or any(char in secret for char in "\r\n")):
            raise ValueError("Explicit Rails origin and service secret are required")
        self.origin = origin.rstrip("/")
        self.client = httpx.AsyncClient(transport=transport, timeout=2, follow_redirects=False, trust_env=False,
            headers={"Authorization": f"Bearer {secret}"})

    async def __call__(self, action, payload):
        if action not in {"redeem", "check"}:
            raise ValueError("Invalid observer action")
        async with asyncio.timeout(3):
            async with self.client.stream("POST", f"{self.origin}/internal/execution_streams/{action}",
                                          json=payload) as response:
                if response.status_code != 200:
                    raise ValueError("Observer authorization unavailable")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 4096:
                        raise ValueError("Observer response too large")
        return json.loads(body)

    async def close(self):
        await self.client.aclose()
