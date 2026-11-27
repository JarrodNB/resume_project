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

_configured = False


def is_content_attribute(key: str) -> bool:
    """True for attributes that may hold speech, instructions or other user content."""
    return ("pii" in key.split(".") or key in CONTENT_ATTRIBUTES or key.startswith("gen_ai.prompt.variable"))


def _without_content(attributes) -> dict:
    return {key: value for key, value in (attributes or {}).items() if not is_content_attribute(key)}


class LiveContentSpanProcessor(SpanProcessor):
    """Drops content attributes and events from each finished span before export.

    Registered ahead of the exporters, it rewrites the shared finished-span snapshot, so every
    later processor and exporter only sees the cleaned span.
    """

    def on_start(self, span, parent_context=None):
        pass

    def on_end(self, span):
        span._attributes = _without_content(span.attributes)
        span._events = [Event(event.name, _without_content(event.attributes), event.timestamp)
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
