"""Trace live interviews in Logfire without any speech content.

The ai-live worker uses the shared Logfire setup (telemetry.tracing) and sends LiveKit Agents'
own OpenTelemetry spans to the same tracer provider, so a session's agent, model and tool spans
join its `live_interview.session` root span as one trace. Before any exporter sees a span, this
module drops everything that could carry what was said or the interviewer's instructions:
LiveKit's `lk.pii.*` attributes (transcripts, chat context, instructions, response text, tool
arguments and output, RPC payloads, room name and participant identity), the GenAI content
attributes LiveKit fills in (`gen_ai.input.messages`, `gen_ai.output.messages`,
`gen_ai.system_instructions`, tool call arguments and results, prompt variables and similar),
the GenAI message events, and exception messages and stack traces. Counts, timings, model names,
tool names and our IDs stay. LiveKit's own PII switch is also turned off (`allow_pii=False`).

Spans from LiveKit's own tracer (instrumentation scope `livekit*`) go further: they keep only
allowlisted attribute keys (LIVEKIT_SAFE_ATTRIBUTES and LIVEKIT_SAFE_PREFIXES: counts,
durations and timings, model/provider names, tool names, IDs, states and error types), on the
span and on each event, so a key a LiveKit upgrade adds is dropped until someone checks it.
"""

from opentelemetry import trace
from opentelemetry.sdk.trace import Event, SpanProcessor
from opentelemetry.trace import Status, StatusCode

from telemetry.tracing import configure_tracing

CONTENT_ATTRIBUTES = frozenset({
    "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
    "gen_ai.tool.call.arguments", "gen_ai.tool.call.result", "gen_ai.tool.description", "gen_ai.tool.definitions",
    "gen_ai.retrieval.query.text", "gen_ai.retrieval.documents", "gen_ai.memory.query.text", "gen_ai.memory.records",
    "gen_ai.evaluation.explanation", "exception.message", "exception.stacktrace",
})
CONTENT_EVENTS = frozenset({
    "gen_ai.system.message", "gen_ai.user.message", "gen_ai.assistant.message", "gen_ai.tool.message",
    "gen_ai.choice", "gen_ai.client.inference.operation.details",
})

# Safe keys on LiveKit's spans and events; everything else is dropped. LiveKit's names are in
# livekit-agents `telemetry/trace_types.py`.
LIVEKIT_SAFE_ATTRIBUTES = frozenset({
    # our IDs (the session root's, if LiveKit spans ever carry them)
    "interview_session_id", "live_connection_id",
    # LiveKit IDs, counts and flags
    "lk.speech_id", "lk.agent_label", "lk.agent_name", "lk.job_id", "lk.room_sid", "lk.participant_kind",
    "lk.retry_count", "lk.provider_request_ids", "lk.generation_id", "lk.parent_generation_id", "lk.generation_count",
    "lk.interrupted", "lk.function_tools", "lk.function_tool.id", "lk.function_tool.name", "lk.function_tool.is_error",
    "lk.keyterms.count", "lk.room.remote_participant_count", "lk.track_sid", "lk.track_source",
    "lk.rpc.payload_size", "lk.rpc.response_size", "lk.rpc.response_timeout", "lk.rpc.error_code", "rpc.method",
    # states and reasons
    "lk.connection_state", "lk.disconnect_reason", "lk.old_state", "lk.new_state", "lk.close_reason",
    "lk.shutdown.reason", "lk.eou.model", "lk.eou.provider", "lk.eou.source", "lk.eou.outcome", "lk.eou.from_cache",
    # durations, timings and metrics (counts and timings only)
    "lk.response.ttft", "lk.response.ttfb", "lk.e2e_latency", "lk.first_frame_delay", "lk.transcription_delay",
    "lk.end_of_turn_delay", "lk.on_user_turn_completed_delay", "lk.speech.queue_wait", "lk.eou.probability",
    "lk.eou.endpointing_delay", "lk.eou.detection_delay", "lk.eou.wait_duration", "lk.pre_connect_audio.duration",
    "lk.llm_metrics", "lk.tts_metrics", "lk.realtime_model_metrics", "lk.transcript_confidence",
    # GenAI names, IDs and status
    "gen_ai.operation.name", "gen_ai.provider.name", "gen_ai.request.model", "gen_ai.request.stream",
    "gen_ai.response.id", "gen_ai.response.model", "gen_ai.response.finish_reasons",
    "gen_ai.response.time_to_first_chunk", "gen_ai.token.type", "gen_ai.conversation.id", "gen_ai.agent.name",
    "gen_ai.tool.name", "gen_ai.tool.call.id", "gen_ai.tool.type", "gen_ai.output.type",
    "error.type", "exception.type", "exception.escaped",
})
LIVEKIT_SAFE_PREFIXES = ("gen_ai.usage.", "lk.job.", "logfire.")  # token counts, job latencies, Logfire's own
_LIVEKIT_SCOPE = "livekit"

_configured = False


def is_content_attribute(key: str) -> bool:
    """True for attributes that may hold speech, instructions or other user content."""
    return ("pii" in key.split(".") or key in CONTENT_ATTRIBUTES or key.startswith("gen_ai.prompt.variable"))


def is_safe_livekit_attribute(key: str) -> bool:
    """True for the allowlisted attributes LiveKit's spans may keep."""
    return (key in LIVEKIT_SAFE_ATTRIBUTES or key.startswith(LIVEKIT_SAFE_PREFIXES)) and not is_content_attribute(key)


def _without_content(attributes, *, livekit: bool = False) -> dict:
    keep = is_safe_livekit_attribute if livekit else (lambda key: not is_content_attribute(key))
    return {key: value for key, value in (attributes or {}).items() if keep(key)}


def _from_livekit(span) -> bool:
    scope = getattr(span, "instrumentation_scope", None)
    return bool(scope and scope.name and scope.name.startswith(_LIVEKIT_SCOPE))


class LiveContentSpanProcessor(SpanProcessor):
    """Drops content attributes and events from each finished span before export (LiveKit's spans
    keep only allowlisted keys).

    Registered ahead of the exporters, it rewrites the shared finished-span snapshot, so every
    later processor and exporter only sees the cleaned span.
    """

    def on_start(self, span, parent_context=None):
        pass

    def on_end(self, span):
        livekit = _from_livekit(span)
        span._attributes = _without_content(span.attributes, livekit=livekit)
        span._events = [Event(event.name, _without_content(event.attributes, livekit=livekit), event.timestamp)
                        for event in span.events if event.name not in CONTENT_EVENTS]
        if span.status.status_code is StatusCode.ERROR and span.status.description:
            span._status = Status(StatusCode.ERROR)

    def shutdown(self):
        pass

    def force_flush(self, timeout_millis=30000):
        return True


def configure_live_tracing(additional_span_processors=()) -> None:
    """Set up Logfire for this worker process once and route LiveKit's spans to it, content-free."""
    global _configured
    if _configured:
        return
    configure_tracing([LiveContentSpanProcessor(), *additional_span_processors])
    from livekit.agents.telemetry import set_tracer_provider

    set_tracer_provider(trace.get_tracer_provider(), allow_pii=False)
    _configured = True
