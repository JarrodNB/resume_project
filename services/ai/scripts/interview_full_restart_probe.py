"""Pause mocked-provider real execution at actual Rails commits for process-kill checks.

Synthetic provider transports are installed before constructing the real executor.
Only Rails/private-storage clients open sockets; no production fault hooks are added.
"""
import asyncio
import os

import httpx

from interviews import audio_providers, models
from interviews.client import RailsInterviewClient, RailsTransportError
from interviews.real import RealInterviewExecutor
from interviews.real_app import configuration
from scripts import interview_mock_runtime


class AcceptanceProbe(RailsInterviewClient):
    async def _acceptance(self, callback):
        point = os.environ.get("CHECK_PAUSE", "none")
        if point == "before_accept":
            print("BARRIER before_accept", flush=True)
            await asyncio.Event().wait()
        receipt = await callback()
        # Exercise exact acceptance replay while the real committed receipt exists.
        assert await callback() == receipt
        if point == "after_accept":
            print("BARRIER after_accept", flush=True)
            await asyncio.Event().wait()
        if point == "lost_receipt":
            print("LOST acceptance receipt", flush=True)
            raise RailsTransportError("Synthetic lost receipt after real commit")
        return receipt

    async def accept(self, claim, **values):
        return await self._acceptance(lambda: super(AcceptanceProbe, self).accept(claim, **values))

    async def accept_preparation(self, claim, **values):
        return await self._acceptance(lambda: super(AcceptanceProbe, self).accept_preparation(claim, **values))


async def main():
    interview_mock_runtime.install_mock_providers()
    configured, reason = configuration()
    if reason:
        raise RuntimeError(reason)
    origin, origins = configured
    async with (
        AcceptanceProbe(origin, os.environ["INTERVIEW_SERVICE_SECRET"], execution_mode="real") as client,
        audio_providers.AudioProviders(client, api_key="synthetic-offline") as audio,
        models.InterviewModels(openai_key="synthetic-offline", typesafe_key="synthetic-offline") as providers,
    ):
        claim = await client.claim(os.environ["CHECK_OPERATION_ID"])
        with httpx.Client(trust_env=False, timeout=15, follow_redirects=False) as storage:
            executor = RealInterviewExecutor(client, audio=audio, models=providers,
                storage_client=storage, allowed_origins=origins, allow_http=True)
            await executor.execute(claim)
        print("PROBE finished", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
