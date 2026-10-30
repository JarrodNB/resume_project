"""
Description: Masks telemetry content before export while preserving application-owned identifiers.
Index:
    - ContactSpanProcessor: captures contact and per-call context at span creation
    - ContactLogProcessor: masks log records before the export queue
    - telemetry_scope: attaches task or prompt metadata to all nested spans
"""

import json
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Lock

from opentelemetry.sdk._logs import LogRecordProcessor
from opentelemetry.sdk.trace import Event, SpanProcessor
from opentelemetry.trace import Link, Status

from privacy.contact_mask import current_known_contact

# These values are supplied by instrumentation, never by user prompt content.
_METADATA_KEYS = frozenset({
    "gen_ai.request.model", "gen_ai.response.model", "gen_ai.provider.name", "gen_ai.system",
    "gen_ai.operation.name", "gen_ai.agent.name", "gen_ai.tool.name", "gen_ai.token.type",
    "model_name", "model", "agent_name", "tool_version", "prompt_version",
    "code.filepath", "code.function", "code.lineno", "logfire.msg_template",
})

_metadata = ContextVar("telemetry_metadata", default=None)


@contextmanager
def telemetry_scope(**attributes):
    """Adds inherited context for spans created inside this block."""
    token = _metadata.set({**(_metadata.get() or {}), **attributes})
    try:
        yield
    finally:
        _metadata.reset(token)


def _mask(value, contact):
    """Mask content recursively, including user keys inside serialized payloads."""
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (ValueError, RecursionError):
            return contact.mask(value)
        masked = _mask(decoded, contact)
        return json.dumps(masked, ensure_ascii=False) if masked != decoded else contact.mask(value)
    if isinstance(value, dict):
        return {contact.mask(key): _mask(item, contact) for key, item in value.items()}
    if isinstance(value, list):
        return [_mask(item, contact) for item in value]
    if isinstance(value, tuple):
        return tuple(_mask(item, contact) for item in value)
    return value


def _mask_metrics(value, contact):
    """Retain instrumentation dimensions inside Logfire's nested metric aggregates."""
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (ValueError, RecursionError):
            return contact.mask(value)
        masked = _mask_metrics(decoded, contact)
        return json.dumps(masked, ensure_ascii=False) if masked != decoded else value
    if isinstance(value, dict):
        return {key: item if key in _METADATA_KEYS else _mask_metrics(item, contact)
                for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_mask_metrics(item, contact) for item in value]
    return value


def _mask_attributes(attributes, contact):
    """Attribute keys are instrumentation; only content values need replacement."""
    return {key: value if key in _METADATA_KEYS else
            _mask_metrics(value, contact) if key == "logfire.metrics" else _mask(value, contact)
            for key, value in attributes.items()}


class ContactSpanProcessor(SpanProcessor):
    """Captures contact on start; sanitizes the shared readable span before exporters."""

    def __init__(self):
        """Retains each task's privacy object only while its spans are active."""
        self.contacts = {}
        self.lock = Lock()

    def on_start(self, span, parent_context=None):
        """Captures task contact before context can change or export moves threads."""
        contact = current_known_contact()
        with self.lock:
            self.contacts[span.context.span_id] = contact
        attributes = {**dict(span.attributes or {}), **(_metadata.get() or {})}
        message = attributes.pop("logfire.msg", None)
        span.set_attributes(_mask_attributes(attributes, contact))
        if message is not None:
            span.set_attribute("logfire.msg", message if message == span.name else contact.mask(message))
        # Span names are static instrumentation identifiers; content belongs in attributes.

    def on_end(self, span):
        """Masks all exported span fields, including exceptions and status descriptions."""
        with self.lock:
            contact = self.contacts.pop(span.context.span_id, current_known_contact())
        # OTel ReadableSpan exposes immutable properties backed by these fields. Updating
        # them here makes every downstream processor receive the sanitized representation.
        attributes = dict(span.attributes or {})
        message = attributes.pop("logfire.msg", None)
        span._attributes = _mask_attributes(attributes, contact)
        if message is not None:
            span._attributes["logfire.msg"] = message if message == span.name else contact.mask(message)
        span._events = tuple(
            Event(
                event.name,
                _mask_attributes(dict(event.attributes or {}), contact),
                event.timestamp,
            )
            for event in span.events
        )
        span._links = tuple(
            Link(link.context, _mask_attributes(dict(link.attributes or {}), contact)) for link in span.links
        )
        span._status = Status(span.status.status_code, _mask(span.status.description, contact))

    def shutdown(self):
        """Discards completed process state."""
        with self.lock:
            self.contacts.clear()

    def force_flush(self, timeout_millis=30000):
        """No buffer is retained by this processor."""
        return True


class ContactLogProcessor(LogRecordProcessor):
    """Sanitizes log body and attributes before any batch log processor."""

    def on_emit(self, record):
        """Masks a log while its task context is still available."""
        contact = current_known_contact()
        record.log_record.body = _mask(record.log_record.body, contact)
        record.log_record.attributes = _mask_attributes(dict(record.log_record.attributes or {}), contact)

    def shutdown(self):
        """This processor retains no records."""

    def force_flush(self, timeout_millis=30000):
        """This processor has no asynchronous work."""
        return True
