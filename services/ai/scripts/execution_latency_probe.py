"""Measure local HTTP dispatch to the real shared runner using a synthetic executor.

No queue, model provider, Redis or Rails process is contacted. Results isolate
HTTP receipt and supervision overhead; they do not measure end-to-end model time.
"""

import argparse
import json
import socket
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import uvicorn
from fastapi import FastAPI

from execution.runner import ExecutionRunner
from routes.executions import install_execution_routes


def measure(*, samples=50, concurrency=1):
    started = {}
    signals = {}

    class Adapter:
        async def claim(self, identity):
            return SimpleNamespace(operation_id=identity, execution_deadline=datetime.now(UTC) + timedelta(seconds=5))

        async def execute(self, claim, output):
            started[claim.operation_id] = time.perf_counter()
            signals[claim.operation_id].set()

        async def heartbeat(self, claim):
            return {}

    runner = ExecutionRunner({"probe": Adapter()}, capacity=concurrency + 2)
    app = FastAPI()
    app.state.execution_runner = runner
    install_execution_routes(app, secret=lambda: "offline-probe-secret")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    server = uvicorn.Server(uvicorn.Config(app, log_level="critical", access_log=False))
    thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
    thread.start()
    until = time.monotonic() + 5
    while not server.started and time.monotonic() < until:
        time.sleep(0.005)
    if not server.started:
        raise RuntimeError("Local probe server did not start")

    def one(_index):
        identity = str(uuid4())
        signals[identity] = threading.Event()
        begin = time.perf_counter()
        response = client.post("/internal/executions", json={"feature": "probe", "operation_id": identity})
        receipt = time.perf_counter()
        response.raise_for_status()
        if not signals[identity].wait(2):
            raise RuntimeError("Synthetic execution did not start")
        return (receipt - begin) * 1000, (started[identity] - begin) * 1000

    try:
        with (
            httpx.Client(base_url=f"http://127.0.0.1:{listener.getsockname()[1]}", trust_env=False,
                         headers={"Authorization": "Bearer offline-probe-secret"}) as client,
            ThreadPoolExecutor(max_workers=concurrency) as pool,
        ):
            rows = list(pool.map(one, range(samples)))
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        listener.close()
        if thread.is_alive():
            raise RuntimeError("Local probe server did not stop")

    def summary(values):
        values = sorted(values)
        return {"p50_ms": round(statistics.median(values), 3),
                "p95_ms": round(values[min(len(values) - 1, int(len(values) * 0.95))], 3)}

    return {"samples": samples, "concurrency": concurrency, "capacity": concurrency + 2,
            "successes": len(rows), "overloads": 0, "errors": 0, "workload": "immediate synthetic executor; no output",
            "receipt": summary([r[0] for r in rows]),
            "execution_start": summary([r[1] for r in rows]), "queue_consumers": 0, "provider_requests": 0,
            "limits": "Local synthetic HTTP dispatch only; excludes Rails commits, screening, providers and streaming."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--concurrency", type=int, default=1)
    arguments = parser.parse_args()
    if arguments.samples < 1 or arguments.concurrency < 1:
        parser.error("samples and concurrency must be positive")
    print(json.dumps(measure(samples=arguments.samples, concurrency=arguments.concurrency), indent=2))
