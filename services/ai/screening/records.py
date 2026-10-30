"""Screen saved database records (career entries, jobs, answers) in as few calls as possible.

Callers turn their snapshot into `ScreenableRecord`s holding only the fields they will put
in a prompt. Fields Rails already approved, or that this run already checked with the same
value, are skipped. Everything else is rendered as labeled plain text and screened in one
blob, split only when it is too long for one classifier call. A single blob that is not
allowed fails the whole call: nothing is approved and no receipts are written.

On success each record with an id gets one `RecordScreening` receipt, which the worker
returns to Rails, and the caller's exact prompt sources are covered for this execution.
Record ids, approved field names and revisions never enter the screened text.

Usage: the async path records classifier usage through `collect_guardrail_usage`, like
every `screen_user_text_async` call. Async callers must open that scope and must not also
add `outcome.decision.model_usages`, or calls would be counted twice. The sync path does
not record anything itself; sync callers add `outcome.decision.model_usages` once, which
covers every blob screened in the call. Reused decisions carry no usage.
"""

import hashlib
import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from privacy.contact_mask import mask_outbound
from schemas.screening_receipts import RecordScreening
from screening.screen_user_text import ScreenOutcome, screen_user_text, screen_user_text_async
from screening.session import current_session, remaining_timeout
from settings import load_settings
from text_limits import MAX_PROMPT_TEXT, MAX_SCREENED_TEXT

RECORD_TYPES = frozenset({
    "user", "experience", "experience_highlight", "project", "education", "certification",
    "skill", "career_context", "job", "gap_response", "interview_question",
})
_TITLE_LIMIT = 5
_ENTRY_SEPARATOR = "\n\n---\n\n"

Classifier = Callable[[str, str, float], Awaitable[Any]]


@dataclass(frozen=True, kw_only=True)
class ScreenableRecord:
    """One saved row's prompt fields, plus the metadata needed to reuse and report checks.

    `fields` holds only the values the caller will render into a prompt. `display_title`
    is the user's own short name for the entry (for example "Senior Engineer at Acme"),
    shown back to them when a check fails. `record_id` is None for legacy snapshots: they
    are screened but never reported to Rails.
    """

    record_type: str
    record_id: str | None
    fields: Mapping[str, str | list[str]]
    display_title: str
    approved_fields: frozenset[str] = frozenset()
    revision: Mapping[str, int] = field(default_factory=dict)

    def __post_init__(self):
        if self.record_type not in RECORD_TYPES:
            raise ValueError(f"Unknown screened record type: {self.record_type}")


@dataclass(frozen=True)
class RecordScreeningOutcome:
    """The decision for the whole call and the records it actually had to screen."""

    decision: ScreenOutcome
    approved_sources: tuple[str, ...]
    pending: tuple[ScreenableRecord, ...]

    @property
    def allowed(self) -> bool:
        return self.decision.allowed


def field_fingerprint(value: str | list[str]) -> str:
    """Match Ruby stdlib JSON.generate, not Rails' HTML-escaping JSON encoder."""
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def screen_records(
    records: Sequence[ScreenableRecord], *, approved_sources: Sequence[str] = (),
    classify: Classifier | None = None,
) -> RecordScreeningOutcome:
    """Screen every pending field of these records together and cover the caller's sources.

    `approved_sources` must contain only values from the records' fields plus trusted
    formatting. All records' complete rendered text must fit the prompt cap and each
    record's pending text must fit one screened string, or the result is `too_long`.
    `classify` is a provider seam with the same signature as
    `screen_user_text_async`'s; chat and interviews pass one billed to their operation.
    It never approves anything by itself.
    """
    plan = _plan(records)
    if isinstance(plan, RecordScreeningOutcome):
        return plan
    pending, blobs = plan
    settings = load_settings()
    if classify is None:
        from screening import prompt_guardrail

        # Looked up at call time so offline tests can replace the provider seam.
        classify = prompt_guardrail.screen_prompt_text
    outcomes = []
    for blob in blobs:
        outcomes.append(await screen_user_text_async(
            blob, settings.user_text_screen_model,
            remaining_timeout(settings.llm_run_timeout_seconds),
            check_phrases=False, classify=classify,
        ))
        if not outcomes[-1].allowed:
            break
    return _finish(pending, outcomes, approved_sources)


def screen_records_sync(
    records: Sequence[ScreenableRecord], *, approved_sources: Sequence[str] = (),
) -> RecordScreeningOutcome:
    """Apply the same policy from synchronous handlers with the configured classifier."""
    plan = _plan(records)
    if isinstance(plan, RecordScreeningOutcome):
        return plan
    pending, blobs = plan
    settings = load_settings()
    outcomes = []
    for blob in blobs:
        outcomes.append(screen_user_text(
            blob, settings.user_text_screen_model,
            remaining_timeout(settings.llm_run_timeout_seconds), check_phrases=False,
        ))
        if not outcomes[-1].allowed:
            break
    return _finish(pending, outcomes, approved_sources)


def record_failure_message(outcome: RecordScreeningOutcome) -> str:
    """User-facing reason a record batch failed, naming a few entries when that helps."""
    from screening.prompt_guardrail import screening_failure_message

    decision = outcome.decision
    if decision.too_long or decision.unchecked:
        return screening_failure_message(decision)
    titles = list(dict.fromkeys(record.display_title.strip() for record in outcome.pending))
    if 0 < len(outcome.pending) <= _TITLE_LIMIT and all(titles):
        return f"We couldn't use: {', '.join(titles)}. Review those entries and try again."
    return ("One of the career entries you added or changed recently couldn't be used. "
            "Review your recent edits and try again.")


def _plan(records):
    """Find pending fields, check sizes and build blobs; return an outcome when no call runs."""
    pending = []
    for record in records:
        fields = _pending_fields(record)
        if fields:
            pending.append((record, fields))
    pending_records = tuple(record for record, _ in pending)
    # Full limits apply to everything the caller will use, even when nothing is pending.
    present = [fields for record in records if (fields := _present_fields(record))]
    full_text = _ENTRY_SEPARATOR.join(
        _render_entry(number, fields) for number, fields in enumerate(present, start=1))
    if len(full_text) > MAX_PROMPT_TEXT:
        return _too_long(pending_records)
    if not pending:
        return [], []
    entries = [_render_entry(number, fields) for number, (_, fields) in enumerate(pending, start=1)]
    if any(len(entry) > MAX_SCREENED_TEXT for entry in entries):
        return _too_long(pending_records)
    blobs = [""]
    for entry in entries:
        joined = blobs[-1] + _ENTRY_SEPARATOR + entry if blobs[-1] else entry
        if len(joined) <= MAX_SCREENED_TEXT:
            blobs[-1] = joined
        else:
            blobs.append(entry)
    return pending, blobs


def _too_long(pending_records):
    return RecordScreeningOutcome(ScreenOutcome(False, too_long=True), (), pending_records)


def _present_fields(record):
    return {name: value for name, value in record.fields.items()
            if (isinstance(value, str) and value.strip())
            or (isinstance(value, list) and any(item.strip() for item in value))}


def _pending_fields(record):
    values = _present_fields(record)
    checked = set(record.approved_fields)
    if record.record_id and (session := current_session()) is not None:
        for receipt in session.record_screening:
            if (receipt.record_type == record.record_type and receipt.record_id == record.record_id
                    and receipt.revision == dict(record.revision)):
                checked.update(name for name, value in values.items()
                               if receipt.fingerprints.get(name) == field_fingerprint(value))
    return {name: value for name, value in values.items() if name not in checked}


def _render_entry(number, fields):
    """Label each field in plain words; lists become one item per line."""
    return f"Entry {number}\n" + "\n\n".join(
        f"{name.replace('_', ' ').capitalize()}:\n" + ("\n".join(value) if isinstance(value, list) else value)
        for name, value in fields.items())


def _finish(pending, outcomes, approved_sources):
    pending_records = tuple(record for record, _ in pending)
    decision = _combine(outcomes)
    if not decision.allowed:
        return RecordScreeningOutcome(decision, (), pending_records)
    if (session := current_session()) is not None:
        for record, fields in pending:
            if record.record_id:
                session.record_screening.append(RecordScreening(
                    record_type=record.record_type, record_id=record.record_id,
                    fingerprints={name: field_fingerprint(value) for name, value in fields.items()},
                    revision=dict(record.revision)))
        session.allowed_sources.update(mask_outbound(source) for source in approved_sources)
    return RecordScreeningOutcome(decision, tuple(approved_sources), pending_records)


def _combine(outcomes):
    """One decision for the call, keeping the usage of every blob that was screened."""
    if not outcomes:
        return ScreenOutcome(True)
    if len(outcomes) == 1:
        return outcomes[0]
    last = outcomes[-1]
    usage = tuple(entry for outcome in outcomes for entry in outcome.model_usages)
    return ScreenOutcome(last.allowed, too_long=last.too_long, unchecked=last.unchecked,
                         completed_usage=usage)
