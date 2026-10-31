"""Screen saved database records (career entries, jobs, answers) in as few calls as possible.

Callers turn their snapshot into `ScreenableRecord`s holding only the fields they will put
in a prompt. Fields Rails already approved, or that this run already checked with the same
value, are skipped. Everything else is rendered as labeled plain text and screened in one
blob, split only when it is too long for one classifier call. A single blob that is not
allowed fails the whole call: nothing is approved and no receipts are written.

On success each record with an id gets one `RecordScreening` receipt, which the worker
returns to Rails, and the caller's exact prompt sources are covered for this execution.
Record ids, approved field names and revisions never enter the screened text.

Size checks use the masked text, because screening masks contact details before its own
length check and a placeholder can be longer than the value it replaces.

Usage: the async path records classifier usage through `collect_guardrail_usage`, like
every `screen_user_text_async` call (or the caller's operation billing, for a custom
`screen`), so its decision carries no usage. The sync path records nothing itself, so its
decision carries the usage of every blob screened in the call and sync callers add
`outcome.decision.model_usages` once. Reused decisions carry no usage.

Two overlapping calls for the same records may both screen and both write receipts
before either finishes. That only repeats work: the exact-text decision cache usually
shares the classifier call, and Rails applies duplicate receipts idempotently.
"""

import hashlib
import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field

from privacy.contact_mask import mask_outbound
from schemas.screening_receipts import RecordScreening
from screening.screen_user_text import ScreenOutcome, screen_user_text, screen_user_text_async
from screening.session import current_session, remaining_timeout
from settings import load_settings
from text_limits import MAX_PROMPT_TEXT, MAX_SCREENED_TEXT

RECORD_TYPES = frozenset({
    "user", "experience", "experience_highlight", "project", "education", "certification",
    "skill", "career_context", "job", "gap_response", "interview_question",
    "job_preference_criterion", "job_board_listing",
})
# Text copied into another row (a saved resume's sections). These are screened but never
# reported, so they must have no record id; Rails has no recorder for them.
UNSAVED_RECORD_TYPES = frozenset({"resume_section"})
_TITLE_LIMIT = 5
_ENTRY_SEPARATOR = "\n\n---\n\n"
MAX_RECORD_FIELDS = 16  # matches RecordScreening.fingerprints

ScreenText = Callable[[str], Awaitable[ScreenOutcome]]


@dataclass(frozen=True, kw_only=True)
class ScreenableRecord:
    """One saved row's prompt fields, plus the metadata needed to reuse and report checks.

    `fields` holds only the values the caller will render into a prompt. `display_title`
    is the user's own short name for the entry (for example "Senior Engineer at Acme"),
    shown back to them when a check fails. `record_id` is None for legacy snapshots: they
    are screened but never reported to Rails. Only `fields` is screened; unused columns of
    the row are not.
    """

    record_type: str
    record_id: str | None
    fields: Mapping[str, str | list[str]]
    display_title: str
    approved_fields: frozenset[str] = frozenset()
    revision: Mapping[str, int] = field(default_factory=dict)

    def __post_init__(self):
        unsaved = self.record_id is None and self.record_type in UNSAVED_RECORD_TYPES
        if self.record_type not in RECORD_TYPES and not unsaved:
            raise ValueError(f"Unknown screened record type: {self.record_type}")
        if len(self.fields) > MAX_RECORD_FIELDS:
            raise ValueError(f"A screened record can have at most {MAX_RECORD_FIELDS} fields")


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
    screen: ScreenText | None = None, combined_prompt: bool = True,
) -> RecordScreeningOutcome:
    """Screen every pending field of these records together and cover the caller's sources.

    `approved_sources` must contain only values from the records' fields plus trusted
    formatting. They are covered when every pending field passes, including when every
    field was already approved. Passing sources when no record has any non-blank field
    raises ValueError, since nothing would back the approval. All records' complete masked text must fit the prompt
    cap and each record's pending text must fit one screened string, or the result is
    `too_long`. Callers that use records in separate bounded prompts may set
    `combined_prompt=False`: complete-record caps still apply, while the caller's
    producer and generative boundaries own total batch and assembled-prompt limits.

    `screen` runs the shared screening policy on one blob, in the style of the
    `allow_text` callbacks elsewhere. It defaults to `screen_user_text_async` with the
    configured model and no phrase check. Chat and spoken interviews pass a partial of
    `screening.conversation.screen_with_operation_models`, so the primary and fallback
    classifiers bill their own operation.
    """
    plan = _plan(records, approved_sources, combined_prompt=combined_prompt)
    if isinstance(plan, RecordScreeningOutcome):
        return plan
    pending, blobs = plan
    screen = screen or _screen_with_settings
    outcomes = []
    for blob in blobs:
        outcomes.append(await screen(blob))
        if not outcomes[-1].allowed:
            break
    return _finish(pending, outcomes, approved_sources, keep_usage=False)


def screen_records_sync(
    records: Sequence[ScreenableRecord], *, approved_sources: Sequence[str] = (),
    combined_prompt: bool = True,
) -> RecordScreeningOutcome:
    """Apply the same policy from synchronous handlers with the configured classifier."""
    plan = _plan(records, approved_sources, combined_prompt=combined_prompt)
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
    return _finish(pending, outcomes, approved_sources, keep_usage=True)


async def _screen_with_settings(text):
    """The default: configured classifier and fallback, task deadline, no phrase check."""
    from screening import prompt_guardrail

    settings = load_settings()
    # Looked up at call time so offline tests can replace the provider seam.
    return await screen_user_text_async(
        text, settings.user_text_screen_model, remaining_timeout(settings.llm_run_timeout_seconds),
        check_phrases=False, classify=prompt_guardrail.screen_prompt_text,
    )


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


def _plan(records, approved_sources, *, combined_prompt=True):
    """Find pending fields, check masked sizes and build blobs, or return an early outcome."""
    if approved_sources and not any(_present_fields(record) for record in records):
        raise ValueError("Approved sources need the records they were built from")
    pending = []
    for record in records:
        fields = _pending_fields(record)
        if fields:
            pending.append((record, fields))
    pending_records = tuple(record for record, _ in pending)
    # Full limits apply to everything the caller will use, even when nothing is pending.
    present = [fields for record in records if (fields := _present_fields(record))]
    complete = [_render_entry(number, fields) for number, fields in enumerate(present, start=1)]
    # Preference checks assess listings in separate prompts. Their producer bounds total
    # batch bytes; the generative boundary still validates each actual assembled prompt.
    prompt_groups = [_ENTRY_SEPARATOR.join(complete)] if combined_prompt else complete
    if any(len(mask_outbound(text)) > MAX_PROMPT_TEXT for text in prompt_groups):
        return _too_long(pending_records)
    if not pending:
        return [], []
    entries = [_render_entry(number, fields) for number, (_, fields) in enumerate(pending, start=1)]
    # Contact values never contain the separator, so a blob's masked length is the sum
    # of its masked entries plus separators. Mask each entry once.
    sizes = [len(mask_outbound(entry)) for entry in entries]
    if any(size > MAX_SCREENED_TEXT for size in sizes):
        return _too_long(pending_records)
    blobs = []
    blob_size = 0
    for entry, size in zip(entries, sizes):
        if blobs and blob_size + len(_ENTRY_SEPARATOR) + size <= MAX_SCREENED_TEXT:
            blobs[-1] += _ENTRY_SEPARATOR + entry
            blob_size += len(_ENTRY_SEPARATOR) + size
        else:
            blobs.append(entry)
            blob_size = size
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
    if (session := current_session()) is not None:
        checked.update(name for name, value in values.items()
                       if _field_key(record, name, value) in session.record_checks)
        for receipt in session.record_screening:
            if (receipt.record_type == record.record_type and receipt.record_id == record.record_id
                    and receipt.revision == dict(record.revision)):
                checked.update(name for name, value in values.items()
                               if receipt.fingerprints.get(name) == field_fingerprint(value))
    return {name: value for name, value in values.items() if name not in checked}


def _field_key(record, name, value):
    return (record.record_type, record.record_id, tuple(sorted(record.revision.items())),
            name, field_fingerprint(value))


def _render_entry(number, fields):
    """Label each field in plain words; lists become one item per line."""
    return f"Entry {number}\n" + "\n\n".join(
        f"{name.replace('_', ' ').capitalize()}:\n" + ("\n".join(value) if isinstance(value, list) else value)
        for name, value in fields.items())


def _finish(pending, outcomes, approved_sources, *, keep_usage):
    pending_records = tuple(record for record, _ in pending)
    decision = _combine(outcomes, keep_usage)
    if not decision.allowed:
        return RecordScreeningOutcome(decision, (), pending_records)
    if (session := current_session()) is not None:
        for record, fields in pending:
            session.record_checks.update(_field_key(record, name, value) for name, value in fields.items())
            if record.record_id:
                fingerprints = {name: field_fingerprint(value) for name, value in fields.items()}
                existing = next((receipt for receipt in session.record_screening
                    if receipt.record_type == record.record_type and receipt.record_id == record.record_id
                    and receipt.revision == dict(record.revision)), None)
                if existing is not None:
                    # A list followed by detail is still one checked record. Keep the
                    # latest exact checked value when a live field changes between reads.
                    existing.fingerprints.update(fingerprints)
                else:
                    session.record_screening.append(RecordScreening(
                        record_type=record.record_type, record_id=record.record_id,
                        fingerprints=fingerprints, revision=dict(record.revision)))
        session.allowed_sources.update(mask_outbound(source) for source in approved_sources)
    return RecordScreeningOutcome(decision, tuple(approved_sources), pending_records)


def _combine(outcomes, keep_usage):
    """One decision for the call; the last blob screened decides it.

    With `keep_usage`, it carries the usage of every blob screened. Otherwise it carries
    none, because that usage was already recorded while screening.
    """
    if not outcomes:
        return ScreenOutcome(True)
    last = outcomes[-1]
    usage = tuple(entry for outcome in outcomes for entry in outcome.model_usages) if keep_usage else ()
    return ScreenOutcome(last.allowed, too_long=last.too_long, unchecked=last.unchecked,
                         completed_usage=usage)
