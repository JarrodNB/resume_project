"""Run local paid verification and halt discovery before saving any failed execution.

Only this check entrypoint disables automatic retries. Provider transports, durable
admission, lease heartbeats and ordinary application recovery remain unchanged.
"""
import os

import uvicorn

from interviews import real_app
from interviews.runtime import RecoveryRuntime


class StopAfterFailureRuntime(RecoveryRuntime):
    """Stop discovering work on failure, before Rails can schedule its next attempt."""

    def __init__(self, client, executor):
        super().__init__(client, executor)
        original_fail = client.fail

        async def stop_and_fail(*args, **kwargs):
            self._stopping = True
            return await original_fail(*args, **kwargs)

        client.fail = stop_and_fail


def main():
    if os.getenv("INTERVIEW_PAID_VERIFICATION") != "true":
        raise RuntimeError("Explicit paid verification opt-in required")
    real_app.RecoveryRuntime = StopAfterFailureRuntime
    uvicorn.run(real_app.app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
