"""Measure local shared-runner/Redis/WebSocket delivery with synthetic work only.

ASGI requests use in-process clients; Redis uses its actual local TCP protocol.
Rails authorization and provider timing are substitutes, so these are framework
measurements, not production, network, screening, or model latency guarantees.
"""
import argparse
import asyncio
import json
import math
import secrets
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from execution.runner import ExecutionRunner
from execution.streaming import StreamBuffer, StreamingOutputs
from routes.execution_streams import install_output_stream
from routes.executions import install_execution_routes


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def run_case(redis_url, *, samples=20, concurrency=1):
    operations = {}
    grants = {}
    timings = {}

    class Adapter:
        async def claim(self, operation_id):
            timings[operation_id]["admitted"] = time.perf_counter()
            return SimpleNamespace(**operations[operation_id],
                execution_deadline=datetime.now(UTC) + timedelta(seconds=10))

        async def heartbeat(self, claim):
            return {}

        async def execute(self, claim, output):
            await output.emit("started")
            await asyncio.sleep(0.005)
            timings[claim.operation_id]["emitted"] = time.perf_counter()
            await output.emit("delta", text="Synthetic public output")
            await output.emit("completed")

    @asynccontextmanager
    async def producer_lifespan(app):
        buffer = StreamBuffer(redis_url)
        app.state.execution_runner = ExecutionRunner({"probe": Adapter()}, capacity=max(2, concurrency * 2),
            output_factory=StreamingOutputs(buffer, {"probe"}))
        yield
        await app.state.execution_runner.close()
        await buffer.close()

    async def owner(action, payload):
        return grants[payload["token"] if action == "redeem" else payload["grant_id"]]

    @asynccontextmanager
    async def consumer_lifespan(app):
        buffer = StreamBuffer(redis_url)
        app.state.execution_streams = (buffer, owner)
        yield
        await buffer.close()

    producer = FastAPI(lifespan=producer_lifespan)
    consumer = FastAPI(lifespan=consumer_lifespan)
    install_execution_routes(producer, secret=lambda: "synthetic-probe-secret")
    install_output_stream(consumer, allowed_origins={"http://probe"})

    with TestClient(producer) as sender, TestClient(consumer) as observer:
        def sample(_):
            operation_id = str(uuid4())
            operation = {"operation_id": operation_id, "attempt_id": str(uuid4()), "claim_generation": 1}
            operations[operation_id] = operation
            timings[operation_id] = {}
            token = secrets.token_urlsafe(32)
            grant = {**operation, "feature": "probe", "grant_id": token,
                     "expires_at": (datetime.now(UTC) + timedelta(seconds=20)).isoformat()}
            grants[token] = grant
            with observer.websocket_connect("/ai/executions/stream", headers={"origin": "http://probe"}) as stream:
                stream.send_json({"type": "authorize", "token": token})
                assert stream.receive_json()["type"] == "attached"
                started = time.perf_counter()
                response = sender.post("/internal/executions", json={"feature": "probe", "operation_id": operation_id},
                    headers={"Authorization": "Bearer synthetic-probe-secret"})
                assert response.status_code == 202
                while True:
                    event = stream.receive_json()
                    if event["type"] == "delta":
                        received = time.perf_counter()
                    if event["type"] == "completed":
                        break
                    assert event["type"] not in {"error", "reset"}
            timing = timings[operation_id]
            return {"admission_ms": (timing["admitted"] - started) * 1000,
                    "relay_ms": (received - timing["emitted"]) * 1000,
                    "first_visible_text_ms": (received - started) * 1000}

        with ThreadPoolExecutor(max_workers=concurrency) as threads:
            results = list(threads.map(sample, range(samples)))
    return {"samples": samples, "concurrency": concurrency, "runner_capacity": max(2, concurrency * 2),
        "milliseconds": {key: {"p50": round(statistics.median([row[key] for row in results]), 3),
                                "p95": round(percentile([row[key] for row in results], 0.95), 3)}
                         for key in results[0]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--redis-url", default="redis://127.0.0.1:56379/0")
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--concurrency", type=int, nargs="+", default=[1, 8])
    args = parser.parse_args()
    parsed = urlsplit(args.redis_url)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or not 1 <= args.samples <= 200 or any(not 1 <= n <= 32 for n in args.concurrency):
        parser.error("Use a local Redis buffer and bounded sample/concurrency counts")
    print(json.dumps({"kind": "local_synthetic_framework_probe",
        "simulated_provider_delay_ms": 5,
        "limitations": ["ASGI clients are in process; external HTTP/TLS/authentication, screening and model latency are excluded.",
                        "Redis uses real local TCP. Results depend on machine load and do not establish a production SLO."],
        "cases": [run_case(args.redis_url, samples=args.samples, concurrency=n) for n in args.concurrency]}, indent=2))


if __name__ == "__main__":
    main()
