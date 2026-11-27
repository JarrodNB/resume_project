"""Adapt interview claims and accepted-result execution to the shared supervisor.

Answer turns may publish provisional spoken text on the runner's optional output sink.
Preparation, transcription and speech operations never stream; Rails acceptance stays
the only canonical result.
"""

import asyncio

from interviews.spoken_stream import SpokenTextStream
from interviews.timing import stage_timing


class InterviewExecutionAdapter:
    stream_output = True

    def __init__(self, client, executor):
        self.client = client
        self.executor = executor

    async def claim(self, operation_id):
        with stage_timing(None, "claim"):
            return await self.client.claim(operation_id)

    async def heartbeat(self, claim):
        return await self.client.heartbeat(claim)

    async def execute(self, claim, output):
        stream = SpokenTextStream(output) if output and claim.kind == "turn" else None
        try:
            return await self.executor.execute(claim, deadline_managed=True, output=stream)
        except asyncio.CancelledError:
            if stream:
                await stream.cancel()
            raise
        finally:
            if stream:
                await stream.close()
