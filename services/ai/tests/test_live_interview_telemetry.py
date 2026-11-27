"""One live session is one trace: LiveKit's spans join ours, without speech content, with the cost.

Uses an in-memory exporter; nothing is sent to Logfire or LiveKit.
"""

import pytest
from livekit.agents.telemetry import tracer as livekit_tracer
from opentelemetry import trace
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from live_interviews import telemetry
from live_interviews.telemetry import configure_live_tracing


@pytest.fixture
def exported(monkeypatch):
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    monkeypatch.setattr(telemetry, "_configured", False)
    spans = InMemorySpanExporter()
    configure_live_tracing([SimpleSpanProcessor(spans)])
    return spans


def test_livekit_spans_join_the_session_trace_without_content_attributes_or_events(exported):
    root = trace.get_tracer("live_interviews").start_span("live_interview.session",
                                                          attributes={"interview_session_id": "session"})
    content = {
        "lk.speech_id": "speech-1",
        "lk.pii.chat_ctx": "[candidate said: my phone is 555 0100]",
        "lk.pii.user_transcript": "I rebuilt the scheduler.",
        "lk.pii.instructions": "You are Priya, a practice interviewer...",
        "lk.pii.response.text": "Tell me about a project.",
        "lk.pii.function_tool.arguments": '{"question_text": "Why?"}',
        "gen_ai.input.messages": "[...]",
        "gen_ai.output.messages": "[...]",
        "gen_ai.system_instructions": "You are Priya...",
        "gen_ai.tool.call.arguments": "{}",
        "gen_ai.prompt.variable.persona": "priya",
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.request.model": "gpt-realtime-2.1-mini",
        "lk.function_tool.name": "ask_follow_up",
    }
    with trace.use_span(root, end_on_exit=True), livekit_tracer.start_as_current_span("llm_node", attributes=content) as span:
        span.add_event("gen_ai.user.message", {"content": "I rebuilt the scheduler."})
        span.add_event("speech_started", {"lk.pii.user_input": "hello", "lk.speech_id": "speech-1"})
        span.record_exception(ValueError("the candidate said something private"))
    spans = {span.name: span for span in exported.get_finished_spans()}
    llm, session = spans["llm_node"], spans["live_interview.session"]
    assert llm.context.trace_id == session.context.trace_id and llm.parent.span_id == session.context.span_id
    attributes = dict(llm.attributes)
    assert not [key for key in attributes if "pii" in key.split(".") or key.startswith(("gen_ai.input", "gen_ai.output"))]
    assert "gen_ai.system_instructions" not in attributes and "gen_ai.tool.call.arguments" not in attributes
    assert "gen_ai.prompt.variable.persona" not in attributes
    assert attributes["lk.speech_id"] == "speech-1" and attributes["gen_ai.usage.input_tokens"] == 120
    assert attributes["gen_ai.request.model"] == "gpt-realtime-2.1-mini"
    assert attributes["lk.function_tool.name"] == "ask_follow_up"
    events = {event.name: dict(event.attributes) for event in llm.events}
    assert "gen_ai.user.message" not in events
    assert events["speech_started"] == {"lk.speech_id": "speech-1"}
    assert "something private" not in str(events.get("exception", {}))


def test_the_session_root_keeps_its_recorded_cost(exported):
    root = trace.get_tracer("live_interviews").start_span("live_interview.session")
    root.set_attributes({"provider_cost_microdollars": 31_000, "operation.cost": 0.031})
    root.end()
    (span,) = exported.get_finished_spans()
    assert span.attributes["operation.cost"] == pytest.approx(0.031)
    assert span.attributes["provider_cost_microdollars"] == 31_000


def test_configuring_twice_adds_the_processors_once(monkeypatch):
    calls = []
    monkeypatch.setattr(telemetry, "_configured", False)
    monkeypatch.setattr(telemetry, "configure_tracing", lambda processors: calls.append(processors))
    configure_live_tracing()
    configure_live_tracing()
    assert len(calls) == 1
