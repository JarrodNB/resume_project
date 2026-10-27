"""Check private timing outcomes without exporting content or altering failures."""

import asyncio
from types import SimpleNamespace

import pytest

from interviews.timing import stage_timing


def test_failed_and_cancelled_stages_preserve_errors_and_fenced_identity(monkeypatch, caplog):
    ticks = iter([10, 10.125, 20, 20.25])
    monkeypatch.setattr("interviews.timing.time.monotonic", lambda: next(ticks))
    caplog.set_level("DEBUG", logger="interviews.timing")
    claim = SimpleNamespace(operation_id="op", attempt_id="second-attempt", claim_generation=2)
    with pytest.raises(ValueError, match="private error"), stage_timing(claim, "transcription"):
        raise ValueError("private error")
    with pytest.raises(asyncio.CancelledError), stage_timing(claim, "speech_synthesis"):
        raise asyncio.CancelledError
    events = [record.__dict__ for record in caplog.records]
    assert [(event["elapsed_ms"], event["outcome"]) for event in events] == [
        (125, "failed"), (250, "cancelled")]
    assert all(event["attempt_id"] == "second-attempt" and event["claim_generation"] == 2 for event in events)
    assert "private error" not in str(events)


def test_telemetry_failure_cannot_replace_execution_failure(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("telemetry unavailable")
    monkeypatch.setattr("interviews.timing.logger.debug", broken)
    claim = SimpleNamespace(operation_id="op", attempt_id="attempt", claim_generation=1)
    with pytest.raises(ValueError, match="execution failed"), stage_timing(claim, "acceptance"):
        raise ValueError("execution failed")


@pytest.mark.parametrize("status_code", [200, 503])
def test_polling_stays_quiet_without_suppressing_later_model_traces(monkeypatch, status_code):
    import httpx
    import logfire
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
    from pydantic_ai import Agent, Embedder
    from pydantic_ai.models.test import TestModel

    from interviews.client import RailsClientError, RailsInterviewClient
    from telemetry.tracing import configure_tracing, flush_tracing

    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    # Production setup enables defaults globally; restore them after this test.
    monkeypatch.setattr(Agent, "_instrument_default", Agent._instrument_default)
    monkeypatch.setattr(Embedder, "_instrument_default", Embedder._instrument_default)
    spans = InMemorySpanExporter()
    configure_tracing([SimpleSpanProcessor(spans)])

    async def transport(request):
        # Represents optional HTTP instrumentation without installing a global hook.
        with logfire.span("GET", **{"http.request.method": "GET"}):
            return httpx.Response(status_code, json={"operation_ids": []})

    async def scenario():
        async with RailsInterviewClient("http://rails.test", "synthetic", transport=httpx.MockTransport(transport)) as client:
            for _ in range(2):
                with stage_timing(None, "discovery"):
                    if status_code == 200:
                        assert await client.discover() == []
                    else:
                        with pytest.raises(RailsClientError):
                            await client.discover()
        # New model tasks must not inherit polling suppression.
        with logfire.span("interview.operation"):
            task = asyncio.create_task(Agent(TestModel()).run("Synthetic candidate answer"))
            await task

    asyncio.run(scenario())
    flush_tracing()
    finished = spans.get_finished_spans()
    names = [span.name for span in finished]
    assert "GET" not in names
    assert "interview.stage" not in names
    assert "interview.operation" in names
    assert any("invoke_agent" in name for name in names)
    assert any("chat" in name for name in names)
