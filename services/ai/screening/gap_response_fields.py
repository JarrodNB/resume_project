"""Screen pending saved-answer fields together without collapsing record identities.

Every queued snapshot keeps its provenance, even when readable text is identical.
Only identified records reuse persisted checks; legacy text still receives screening.
"""

from collections.abc import Awaitable, Callable, Sequence

from privacy.contact_mask import mask_outbound
from schemas.gap_response import GapResponseSnapshot
from schemas.screening_receipts import GapResponseScreening
from screening.job_fields import field_fingerprint
from screening.screen_user_text import ScreenOutcome
from screening.session import current_session
from text_limits import MAX_SCREENED_TEXT

FIELDS = ("requirement", "body")


async def screen_gap_response_fields(
    sources: Sequence[tuple[GapResponseSnapshot, str]],
    classify: Callable[[str], Awaitable[ScreenOutcome]],
) -> dict[str, ScreenOutcome]:
    """Return conservative source decisions and report all checked IDs.

    Caller-built source text may contain only the snapshot requirement/body and
    trusted scaffolding. Metadata and unrelated text must never enter that source.
    """
    if not sources:
        return {}
    session = current_session()
    # Full input limits still apply when saved approvals remove classifier work.
    full_text = _group(list(dict.fromkeys(text for _, text in sources)))
    if len(full_text) > MAX_SCREENED_TEXT:
        return {text: ScreenOutcome(False, too_long=True) for _, text in sources}
    pending = []
    for snapshot, text in sources:
        checked = set(snapshot.screened_fields) if snapshot.id else set()
        if snapshot.id and session is not None:
            for report in session.gap_response_screening:
                if report.response_id == snapshot.id:
                    checked.update(name for name in FIELDS
                                   if report.fields.get(name) == field_fingerprint(getattr(snapshot, name)))
        fields = {name: getattr(snapshot, name) for name in FIELDS
                  if name not in checked and getattr(snapshot, name).strip()}
        pending.append((snapshot, text, fields))
    cached = session.decisions if session is not None else {}
    envelopes = list(dict.fromkeys("\n\n".join(f"{name}:\n{value}" for name, value in fields.items())
                                  for _, _, fields in pending if fields and _key(fields) not in cached))
    grouped = _group(envelopes)
    decision = (ScreenOutcome(False, too_long=True) if len(grouped) > MAX_SCREENED_TEXT
                else await classify(grouped) if envelopes else ScreenOutcome(True))
    outcomes = {}
    for snapshot, text, fields in pending:
        outcome = cached.setdefault(_key(fields), decision) if fields else ScreenOutcome(True)
        if text not in outcomes or outcomes[text].allowed:
            outcomes[text] = outcome
        if outcome.allowed and fields and snapshot.id and session is not None:
            report = GapResponseScreening(response_id=snapshot.id,
                fields={name: field_fingerprint(value) for name, value in fields.items()})
            if report not in session.gap_response_screening:
                session.gap_response_screening.append(report)
    if session is not None:
        session.allowed_sources.update(mask_outbound(text) for text, outcome in outcomes.items() if outcome.allowed)
    return outcomes


def _group(texts):
    return "\n\n".join(f"Saved gap response {number}:\n{text}" for number, text in enumerate(texts, start=1))


def _key(fields):
    return ("gap_response_fields", *fields.items())
