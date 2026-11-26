"""Compose optional output transport only for server-registered streaming features."""

from contextlib import asynccontextmanager


@asynccontextmanager
async def optional_streaming(app, runner, *, redis_url, rails_origin, secret):
    app.state.execution_streams = None
    app.state.streaming_reason = "final_only"
    features = {name for name, adapter in runner.adapters.items()
                if getattr(adapter, "stream_output", False)}
    if not features:
        yield
        return
    if not redis_url:
        app.state.streaming_reason = "not_configured"
        yield
        return
    from execution.stream_owner import RailsStreamOwner
    from execution.streaming import StreamBuffer, StreamingOutputs

    buffer = StreamBuffer(redis_url)
    owner = RailsStreamOwner(rails_origin, secret)
    previous = runner.output_factory
    runner.output_factory = StreamingOutputs(buffer, features)
    app.state.execution_streams = (buffer, owner)
    app.state.streaming_reason = None
    try:
        yield
    finally:
        runner.output_factory = previous
        app.state.execution_streams = None
        await owner.close()
        await buffer.close()
