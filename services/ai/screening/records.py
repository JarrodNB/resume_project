"""Reuse trusted saved-record checks and report completed successes to Rails.

The snapshot must match the complete source exactly. Local limits and phrase checks
still apply before reuse. Rails alone persists reports, rejecting edited record versions.
"""
import hashlib
import json

from schemas.record_screening import RecordScreeningState
from screening.obvious_instruction_override import has_obvious_instruction_override
from screening.screen_user_text import ScreenOutcome, screen_user_text, screen_user_text_async
from screening.session import current_session
from text_limits import MAX_SCREENED_TEXT
from worker.contact_mask import current_known_contact, mask_outbound
from worker.queue_messages import ScreeningSuccess
from worker.settings import load_settings

# Bump whenever classifier instructions, thresholds or local screening rules change.
SCREENING_POLICY_VERSION = "2"


def screening_policy_version(model: str) -> str:
    """Include effective provider configuration without persisting text fingerprints."""
    settings = load_settings()
    contact = current_known_contact()
    identity = [(value, token) for value, token, _pattern in getattr(contact, "pairs", ())]
    configuration = json.dumps([model, settings.user_text_screen_fallback_model,
                                settings.user_text_screen_chunk_size, identity], separators=(",", ":"))
    return SCREENING_POLICY_VERSION + ":" + hashlib.sha256(configuration.encode()).hexdigest()[:24]


def _reuse(text, state, model, check_phrases):
    protected = mask_outbound(text)
    if len(protected) > MAX_SCREENED_TEXT:
        return ScreenOutcome(False, too_long=True)
    if check_phrases and has_obvious_instruction_override(protected):
        return ScreenOutcome(False)
    if (state is not None and state.source == text and state.screened_at is not None
            and state.screening_policy_version == screening_policy_version(model)):
        if (session := current_session()) is not None:
            session.allowed_sources.add(protected)
        return ScreenOutcome(True)
    return None


def _report(text, state, model, outcome):
    session = current_session()
    if outcome.allowed and state is not None and state.source == text and session is not None:
        report = ScreeningSuccess(record_type=state.record_type, record_id=state.record_id,
                                  observed_updated_at=state.observed_updated_at,
                                  screening_policy_version=screening_policy_version(model))
        if report not in session.screening_successes:
            session.screening_successes.append(report)
    return outcome


def screen_record(text: str, state: RecordScreeningState | None, *, model: str,
                  timeout_seconds: float, check_phrases: bool = False) -> ScreenOutcome:
    """Check one complete snapshot, never granting approval to a modified projection."""
    reused = _reuse(text, state, model, check_phrases)
    if reused is not None:
        return reused
    return _report(text, state, model, screen_user_text(
        text, model=model, timeout_seconds=timeout_seconds, check_phrases=check_phrases,
    ))


async def screen_record_async(text: str, state: RecordScreeningState | None, *, model: str,
                              timeout_seconds: float, classify, check_phrases: bool = False) -> ScreenOutcome:
    """Apply the same record policy using the existing bounded async classifier seam."""
    reused = _reuse(text, state, model, check_phrases)
    if reused is not None:
        return reused
    return _report(text, state, model, await screen_user_text_async(
        text, model=model, timeout_seconds=timeout_seconds, classify=classify,
        check_phrases=check_phrases,
    ))
