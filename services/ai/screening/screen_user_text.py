"""
Description: Screens one user-written string before it can enter a prompt. An obvious
instruction-override phrase blocks without a model call. Otherwise Jev is asked, and the text
is blocked when either yes-probability is at least 0.7. A missing API key or a failed call
blocks without sending the text on (fail closed).
Index:
    - ScreenOutcome: allowed or not, plus Jev usage when a call was made
    - screen_user_text: the check used by gap analysis, tailoring, and resume import
    - reported_model_name: the model name to bill (the version that answered, or the setting)
"""

import logging
import os
from typing import NamedTuple

from pydantic_ai.usage import RunUsage

from agents.user_text_screen_agent import screen_user_message
from screening.obvious_instruction_override import has_obvious_instruction_override
from screening.yes_confidence import blocks_on_yes_confidence
from text_limits import MAX_SCREENED_TEXT
from worker.model_prices import MODEL_PRICES

logger = logging.getLogger(__name__)


class ScreenOutcome(NamedTuple):
    """Whether the text may enter a prompt, and the Jev usage to report when a call ran.
    `too_long` is a size rejection, not a safety block. `unchecked` means the screen did not
    run (no key, or the call failed), which is also not a safety block."""

    allowed: bool
    usage: RunUsage | None = None
    model: str | None = None
    too_long: bool = False
    unchecked: bool = False


def reported_model_name(response_model_name: str, configured_model: str) -> str:
    """Bills the version the API named when that name has a price; otherwise the setting."""
    if response_model_name in MODEL_PRICES:
        return response_model_name
    return configured_model


def screen_user_text(
    text: str, model: str, timeout_seconds: float, *, check_phrases: bool = True
) -> ScreenOutcome:
    """Returns whether `text` may be put in a prompt. Never raises for a Jev failure.
    `check_phrases` is for a short note. A whole resume skips it and lets Jev decide."""
    if not text.strip():
        return ScreenOutcome(allowed=True)
    if len(text) > MAX_SCREENED_TEXT:
        return ScreenOutcome(allowed=False, too_long=True)
    if check_phrases and has_obvious_instruction_override(text):
        return ScreenOutcome(allowed=False)
    if not os.environ.get("TYPESAFE_API_KEY", "").strip():
        logger.warning("TYPESAFE_API_KEY is unset; leaving user text out of the prompt")
        return ScreenOutcome(allowed=False, unchecked=True)
    try:
        run = screen_user_message(text, model=model, timeout_seconds=timeout_seconds)
    except Exception:
        logger.exception("Jev screen failed; leaving the text out of the prompt")
        return ScreenOutcome(allowed=False, unchecked=True)
    allowed = not blocks_on_yes_confidence(run.screen, run.confidence)
    return ScreenOutcome(
        allowed=allowed,
        usage=run.usage,
        model=reported_model_name(run.model_name, model),
    )
