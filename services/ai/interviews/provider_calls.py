"""Register every interview dispatch with Rails before potentially spending money.

A new identity means one actual request, including a validation retry or safety
classifier request. Provider libraries must disable their own retries. Unknown
usage stays reserved after timeout, cancellation, invalid output or a lost receipt.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


class ProviderCalls:
    """A feature-scoped accounting boundary shared by audio and future agent stages."""

    def __init__(self, rails):
        self._rails = rails

    async def run(
        self,
        claim,
        stage: str,
        provider: str,
        model: str,
        dispatch: Callable[[], Awaitable[tuple[Any, list[dict[str, int]]]]],
    ):
        identity = str(uuid4())
        # A lost admission receipt cannot start a dispatch. The durable reservation
        # may remain unused, which is conservative and recoverable by reconciliation.
        await self._rails.start_provider(claim, identity, stage, provider, model)
        entries = []
        try:
            remaining = (claim.execution_deadline - datetime.now(UTC)).total_seconds()
            if remaining <= 0:
                raise TimeoutError("Interview execution deadline exceeded")
            async with asyncio.timeout(remaining):
                result, entries = await dispatch()
            return result
        finally:
            # CancelledError also passes here. If this callback is interrupted or
            # fails, Rails' preregistered marker and full reservation remain intact.
            await self._rails.usage(
                claim, entries, incomplete=not bool(entries), observation_id=identity
            )
