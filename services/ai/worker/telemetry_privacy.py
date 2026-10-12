"""
Description: Sanitizes completed telemetry synchronously before any asynchronous exporter.
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

from worker.contact_mask import current_known_contact

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
    """Masks nested values, decoding serialized JSON before replacing known contact."""
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (ValueError, RecursionError):
            return contact.mask(value)
        masked = _mask(decoded, contact)
        if masked != decoded:
            return json.dumps(masked, ensure_ascii=False)
        return contact.mask(value)
    if isinstance(value, dict):
        return {_mask(key, contact): _mask(item, contact) for key, item in value.items()}
    if isinstance(value, list):
        return [_mask(item, contact) for item in value]
    if isinstance(value, tuple):
        return tuple(_mask(item, contact) for item in value)
    return value


class ContactSpanProcessor(SpanProcessor):
    """Captures contact on start; sanitizes the shared readable span before exporters."""

    def __init__(self):
        """Keeps immutable contact maps only for active spans."""
        self.contacts = {}
        self.lock = Lock()

    def on_start(self, span, parent_context=None):
        """Captures task contact before context can change or export moves threads."""
        contact = current_known_contact()
        with self.lock:
            self.contacts[span.context.span_id] = contact
        span.set_attributes(
            _mask({**dict(span.attributes or {}), **(_metadata.get() or {})}, contact)
        )
        span.update_name(contact.mask(span.name))

    def on_end(self, span):
        """Masks all exported span fields, including exceptions and status descriptions."""
        with self.lock:
            contact = self.contacts.pop(span.context.span_id, current_known_contact())
        # OTel ReadableSpan exposes immutable properties backed by these fields. Updating
        # them here makes every downstream processor receive the sanitized representation.
        span._name = contact.mask(span.name)
        span._attributes = _mask(dict(span.attributes or {}), contact)
        span._events = tuple(
            Event(
                contact.mask(event.name),
                _mask(dict(event.attributes or {}), contact),
                event.timestamp,
            )
            for event in span.events
        )
        span._links = tuple(
            Link(link.context, _mask(dict(link.attributes or {}), contact)) for link in span.links
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
        record.log_record.attributes = _mask(dict(record.log_record.attributes or {}), contact)

    def shutdown(self):
        """This processor retains no records."""

    def force_flush(self, timeout_millis=30000):
        """This processor has no asynchronous work."""
        return True
