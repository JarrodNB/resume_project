"""Pause a fictional offline turn at its real Rails acceptance boundary.

The Docker recovery check kills this process, then starts the ordinary runtime.
This helper injects no production hooks and never changes provider behavior.
"""

import asyncio
import os

import httpx

from interviews.app import RuntimeSettings, isolate_fake_process
from interviews.client import RailsInterviewClient, RailsTransportError
from interviews.executor import InterviewExecutor


class AcceptanceProbe(RailsInterviewClient):
    """Keep the real HTTP boundary, pausing only immediately before/after it."""

    async def accept(self, claim, **values):
        point = os.environ.get("CHECK_PAUSE", "none")
        if point == "before_accept":
            print("BARRIER before_accept", flush=True)
            await asyncio.Event().wait()
        receipt = await super().accept(claim, **values)
        if point == "after_accept":
            print("BARRIER after_accept", flush=True)
            await asyncio.Event().wait()
        if point == "lost_receipt":
            # Rails really committed; only the local caller loses the receipt.
            print("LOST acceptance receipt", flush=True)
            raise RailsTransportError("Simulated receipt loss after real HTTP commit")
        return receipt


async def main():
    isolate_fake_process()
    settings = RuntimeSettings.from_environment()
    if not settings.enabled:
        raise RuntimeError("Only enabled fictional fake-runtime checks are allowed")
    async with AcceptanceProbe(settings.rails_origin, settings.secret) as client:
        claim = await client.claim(os.environ["CHECK_OPERATION_ID"])
        with httpx.Client(trust_env=False, timeout=15, follow_redirects=False) as storage:
            executor = InterviewExecutor(client, storage_client=storage,
                allowed_origins=set(settings.storage_origins), allow_http=True,
                scenario=settings.scenario)
            await executor.execute(claim)
        print("PROBE finished", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
