"""Register saved source bytes and identify completed classifier approvals.

Only trusted builders after owner-scoped database reads or immutable server snapshots may
register sources. Queue text, imports, temporary edits, and unknown history are not saved
provenance. Registration never approves text: the common classifier policy still decides.
"""

import hashlib
import json
from collections.abc import Sequence

from agents.user_text_screen_agent import BOOLEAN_THRESHOLD
from prompts.user_text_fallback_instructions import (
    USER_TEXT_FALLBACK_INSTRUCTIONS,
    USER_TEXT_FALLBACK_PROMPT_VERSION,
)
from prompts.user_text_screen_instructions import (
    USER_TEXT_SCREEN_INSTRUCTIONS,
    USER_TEXT_SCREEN_PROMPT_VERSION,
)
from schemas.screening_success import ScreeningSuccess
from schemas.user_text_fallback import UserTextFallbackScreen
from schemas.user_text_screen import UserTextScreen
from screening.obvious_instruction_override import OBVIOUS_OVERRIDE_PHRASES
from screening.session import current_session
from screening.yes_confidence import YES_CONFIDENCE_THRESHOLD
from worker.contact_mask import mask_outbound
from worker.settings import load_settings

POLICY_REVISION = "saved-classifier-v1"


def register_saved_sources(sources: Sequence[str]) -> None:
    """Declare exact source values obtained by trusted server reads, never caller approval.

    Builders must later reconstruct every untrusted prompt value from these same sources.
    This function must not be called on arbitrary user-supplied task dictionaries.
    """
    if (session := current_session()) is not None:
        session.saved_sources.update(mask_outbound(source) for source in sources)


def screening_success(text: str, model: str, max_characters: int) -> ScreeningSuccess:
    """Fingerprint protected classifier bytes and all effective classifier policy settings.

    The caller's phrase toggle is a local precondition, checked before every reuse. Both
    callers classify the same bytes with the same classifier; current phrase rules still
    reject locally even when a less restrictive caller previously checked that source.
    """
    settings = load_settings()
    policy = {
        "revision": POLICY_REVISION, "model": model,
        "fallback_model": settings.user_text_screen_fallback_model,
        "instructions": USER_TEXT_SCREEN_INSTRUCTIONS, "version": USER_TEXT_SCREEN_PROMPT_VERSION,
        "fallback_instructions": USER_TEXT_FALLBACK_INSTRUCTIONS,
        "fallback_version": USER_TEXT_FALLBACK_PROMPT_VERSION,
        "schema": UserTextScreen.model_json_schema(),
        "fallback_schema": UserTextFallbackScreen.model_json_schema(),
        "threshold": YES_CONFIDENCE_THRESHOLD, "boolean_threshold": BOOLEAN_THRESHOLD,
        "phrases": OBVIOUS_OVERRIDE_PHRASES, "chunk_size": settings.user_text_screen_chunk_size,
        "overlap": 300, "max_characters": max_characters,
    }
    return ScreeningSuccess(
        content_digest=hashlib.sha256(mask_outbound(text).encode()).hexdigest(),
        policy_identity=hashlib.sha256(json.dumps(policy, sort_keys=True).encode()).hexdigest(),
    )
