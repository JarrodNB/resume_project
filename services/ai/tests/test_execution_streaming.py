"""Exercise shared output/replay through actual Redis and authenticated sockets."""
import asyncio
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import pytest
import redis


@pytest.fixture(scope="module")
def redis_url(tmp_path_factory):
    executable = os.getenv("REDIS_SERVER") or shutil.which("redis-server")
    if not executable:
        candidate = Path("/workspace/resume_project/.native/bin/redis-server")
        executable = str(candidate) if candidate.is_file() else None
    if not executable:
        pytest.skip("A local Redis server is required for streaming integration checks")
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
    process = subprocess.Popen([executable, "--bind", "127.0.0.1", "--port", str(port),
        "--save", "", "--appendonly", "no"], cwd=tmp_path_factory.mktemp("streams"),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"redis://127.0.0.1:{port}/0"
    client = redis.Redis.from_url(url, socket_connect_timeout=0.1, socket_timeout=0.1)
    try:
        until = time.monotonic() + 5
        while True:
            try:
                client.ping()
                break
            except redis.RedisError:
                if time.monotonic() > until:
                    raise
                time.sleep(0.01)
        yield url
    finally:
        client.close()
        process.terminate()
        process.wait(timeout=5)


def identity():
    return dict(feature="test_stream", operation_id=str(uuid4()), attempt_id=str(uuid4()),
                claim_generation=1)


def test_output_is_replayed_in_order_by_another_replica(redis_url):
    from execution.streaming import StreamBuffer

    async def scenario():
        producer = StreamBuffer(redis_url)
        observer = StreamBuffer(redis_url)
        metadata = identity()
        sink = producer.sink(**metadata)
        assert await sink.emit("delta", text="Hello ")
        assert await sink.emit("delta", text="world")
        events = await observer.read(metadata, "0-0", block_ms=1)
        assert [event[1]["text"] for event in events] == ["Hello ", "world"]
        assert all(event[1]["attempt_id"] == metadata["attempt_id"] for event in events)
        assert await observer.read(metadata, events[-1][0], block_ms=1) == []
        await producer.close()
        await observer.close()

    asyncio.run(scenario())
