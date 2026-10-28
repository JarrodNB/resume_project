"""Run bounded paid verification while refusing new work after the first failure.

Only this explicitly opted-in harness pauses admission before reporting failure.
The shared runner still completes admitted execution/accounting; ordinary app
recovery, provider transports and lease fencing retain their normal behavior.
"""
import os

import uvicorn

import app as http_app
from execution.runner import ExecutionRunner


class StopAfterFailureRunner(ExecutionRunner):
    """Pause the same execution runner before Rails can schedule another attempt."""

    def __init__(self, adapters, **options):
        super().__init__(adapters, **options)
        client = adapters["interviews"].client
        original_fail = client.fail

        async def stop_and_fail(*args, **kwargs):
            self.pause()
            return await original_fail(*args, **kwargs)

        client.fail = stop_and_fail


def main():
    if os.getenv("INTERVIEW_PAID_VERIFICATION") != "true":
        raise RuntimeError("Explicit paid verification opt-in required")
    http_app.ExecutionRunner = StopAfterFailureRunner
    uvicorn.run(http_app.app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
