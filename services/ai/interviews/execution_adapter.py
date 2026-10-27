"""Adapt interview claims and accepted-result execution to the shared supervisor."""

from interviews.timing import stage_timing


class InterviewExecutionAdapter:
    def __init__(self, client, executor):
        self.client = client
        self.executor = executor

    async def claim(self, operation_id):
        with stage_timing(None, "claim"):
            return await self.client.claim(operation_id)

    async def heartbeat(self, claim):
        return await self.client.heartbeat(claim)

    async def execute(self, claim, output):
        # Interviews deliver accepted results through Rails, not token streams.
        return await self.executor.execute(claim, deadline_managed=True)
