"""Measure the actual recovery scheduler using synthetic turn-to-speech work.

No Rails, storage, model clients, credentials or provider sockets are used. These
numbers isolate scheduler waiting, not real provider or browser response time.
"""

import argparse
import asyncio
import json
import math
import platform
import statistics
import time
from types import SimpleNamespace

from interviews.runtime import RecoveryRuntime


async def measure(*, samples=5, discovery_seconds=2):
    """Run bounded sequential samples at different points in a polling cycle."""
    if not 1 <= samples <= 20 or not 0.01 <= discovery_seconds <= 10:
        raise ValueError("Use 1–20 samples and a discovery interval of 0.01–10 seconds")
    results = []
    for index in range(samples):
        work_seconds = discovery_seconds * (0.05, 0.25, 0.5, 0.75, 0.95)[index % 5]
        results.append(await _sample(work_seconds, discovery_seconds))
    waits = sorted(row["turn_completed_to_speech_claim_ms"] for row in results)
    return {
        "mode": "synthetic_scheduler_only", "clock": "process_monotonic",
        "python": platform.python_version(), "samples": samples,
        "discovery_seconds": discovery_seconds, "results": results,
        "speech_claim_wait_ms": {"median": statistics.median(waits),
                                 "p95_nearest_rank": waits[math.ceil(samples * 0.95) - 1]},
        "unmeasured": ["browser_upload", "real_providers", "storage", "browser_playback", "first_audible_speech"],
    }


async def _sample(work_seconds, discovery_seconds):
    """Keep each sample's clients and clock records isolated."""
    done = asyncio.Event()
    queued_at = time.monotonic()
    times = {}
    pending = ["turn"]
    discovery_count = 0

    class Client:
        async def discover(self):
            nonlocal discovery_count
            discovery_count += 1
            return list(pending)

        async def claim(self, identity):
            pending.remove(identity)
            times[identity + "_claimed"] = time.monotonic()
            return SimpleNamespace(operation_id=identity)

        async def heartbeat(self, claim):
            return {}

        async def cleanup(self):
            return {}

    class Executor:
        async def execute(self, claim):
            if claim.operation_id == "turn":
                await asyncio.sleep(work_seconds)
                times["speech_created"] = time.monotonic()
                pending.append("speech")
            else:
                done.set()

    runtime = RecoveryRuntime(Client(), Executor(), discovery_seconds=discovery_seconds)
    await runtime.start()
    try:
        await asyncio.wait_for(done.wait(), timeout=discovery_seconds * 3 + 2)
    finally:
        await runtime.stop()
    return {
        "synthetic_turn_work_ms": round(work_seconds * 1000, 3),
        "turn_queue_to_claim_ms": round((times["turn_claimed"] - queued_at) * 1000, 3),
        "turn_completed_to_speech_claim_ms": round(
            (times["speech_claimed"] - times["speech_created"]) * 1000, 3),
        "discovery_requests": discovery_count,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--discovery-seconds", type=float, default=2)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(measure(samples=args.samples, discovery_seconds=args.discovery_seconds)), indent=2))


if __name__ == "__main__":
    main()
