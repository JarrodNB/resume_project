"""Compose optional output transport only for server-registered streaming features."""

from contextlib import asynccontextmanager


@asynccontextmanager
async def optional_streaming(app, runner, *, enabled, redis_url, rails_origin, secret):
    app.state.execution_streams = None
    app.state.streaming_reason = "disabled"
    features = {name for name, adapter in runner.adapters.items()
                if name != "interviews" and getattr(adapter, "stream_output", False)}
    if not enabled or not features:
        app.state.streaming_reason = "disabled" if not enabled else "final_only"
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
