"""Run an MCP tool server over real HTTP on localhost, in a background thread.

Tests and offline evals use this to talk to the same HTTP app, auth and transport as
the `ai-mcp` service, with a synthetic library reader instead of the database.
"""
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

import uvicorn


@contextmanager
def serve_in_background(app) -> Iterator[str]:
    """Serve `app` on a free local port and yield its MCP URL until the block ends."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():
            raise RuntimeError("Local MCP server did not start")
        time.sleep(0.01)
    try:
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()
