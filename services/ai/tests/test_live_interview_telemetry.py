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


def test_livekit_spans_keep_only_allowlisted_keys_so_an_unknown_attribute_is_dropped(exported):
    safe = {
        "lk.speech_id": "speech-1", "lk.generation_id": "gen-1", "lk.interrupted": False,
        "lk.function_tool.name": "next_question", "lk.function_tool.is_error": False, "lk.response.ttft": 0.4,
        "lk.e2e_latency": 0.9, "gen_ai.request.model": "gpt-realtime-2.1-mini", "gen_ai.provider.name": "openai",
        "gen_ai.usage.audio.input_tokens": 300, "gen_ai.tool.name": "next_question", "error.type": "TimeoutError",
        "live_connection_id": "c-1",
    }
    unknown = {"lk.brand_new_text": "I rebuilt the scheduler.", "gen_ai.new.content": "private", "notes": "private"}
    ids = {"interview_session_id": "s-1"}  # kept, though Logfire's default scrubbing masks its value ("session")
    with livekit_tracer.start_as_current_span("agent_turn", attributes={**safe, **ids, **unknown}) as span:
        span.add_event("new_livekit_event", {"lk.speech_id": "speech-1", "text": "I rebuilt the scheduler."})
    (turn,) = [span for span in exported.get_finished_spans() if span.name == "agent_turn"]
    kept = dict(turn.attributes)
    assert safe.items() <= kept.items()
    assert "interview_session_id" in kept and not set(unknown) & set(kept)
    assert [dict(event.attributes) for event in turn.events] == [{"lk.speech_id": "speech-1"}]
    assert "scheduler" not in str(dict(turn.attributes))


def test_our_own_spans_keep_their_attributes_except_content(exported):
    with trace.get_tracer("live_interviews").start_as_current_span("live_interview.step",
                                                                   attributes={"step": "claim", "lk.pii.x": "y"}):
        pass
    (span,) = exported.get_finished_spans()
    assert span.attributes["step"] == "claim" and "lk.pii.x" not in span.attributes


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
