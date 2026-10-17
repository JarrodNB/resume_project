"""
Description: Screens one user-written string before it can enter a prompt. An obvious
instruction-override phrase blocks without a model call. Otherwise Jev is asked, and the text
is blocked when either yes-probability is at least 0.7. A missing API key or a failed call
blocks without sending the text on (fail closed). A request, tool-call, or token cap is
re-raised so the task fails instead of being treated as an unchecked screen.
Index:
    - ScreenOutcome: allowed or not, plus Jev usage when a call was made
    - screen_user_text: the check used by gap analysis, tailoring, and resume import
    - reported_model_name: re-exported from worker.model_prices (the name to bill)
"""

import logging
import os
from collections.abc import Awaitable, Callable, Generator
from time import monotonic
from typing import Any, NamedTuple

from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import RunUsage

from agents.user_text_screen_agent import screen_user_message
from screening.obvious_instruction_override import has_obvious_instruction_override
from screening.session import current_session
from screening.yes_confidence import blocks_on_yes_confidence
from text_limits import MAX_SCREENED_TEXT
from worker.contact_mask import mask_outbound
from worker.model_prices import reported_model_name
from worker.settings import load_settings

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


def screen_user_text(
    text: str, model: str, timeout_seconds: float, *, check_phrases: bool = True,
    max_characters: int = MAX_SCREENED_TEXT,
) -> ScreenOutcome:
    """Returns whether `text` may be put in a prompt. A Jev outage returns unchecked and does
    not raise. A request, tool-call, or token cap raises UsageLimitExceeded so the task fails.
    `check_phrases` is for a short note. A whole resume skips it and lets Jev decide.
    Trusted import code may adjust `max_characters` after validating original text:
    privacy placeholders expand the protected text, but every character is still screened.
    """
    screening = _screen_pass(text, model, timeout_seconds, check_phrases, max_characters)
    try:
        chunk, timeout = next(screening)
        while True:
            try:
                run = screen_user_message(chunk, model=model, timeout_seconds=timeout)
            except Exception as error:  # noqa: BLE001 — shared policy below logs and fails closed
                chunk, timeout = screening.throw(error)
            else:
                chunk, timeout = screening.send(run)
    except StopIteration as done:
        return done.value


async def screen_user_text_async(
    text: str, model: str, timeout_seconds: float, *, check_phrases: bool = False,
    max_characters: int = MAX_SCREENED_TEXT,
    classify: Callable[[str, str, float], Awaitable[Any]],
) -> ScreenOutcome:
    """Apply the same policy without blocking an agent's running event loop.

    The classifier is a provider seam, not an approval: every returned decision still
    goes through confidence, fail-closed, cap, cache, and usage processing below.
    """
    screening = _screen_pass(text, model, timeout_seconds, check_phrases, max_characters)
    try:
        chunk, timeout = next(screening)
        while True:
            try:
                run = await classify(chunk, model, timeout)
            except Exception as error:  # noqa: BLE001 — shared policy below logs and fails closed
                chunk, timeout = screening.throw(error)
            else:
                chunk, timeout = screening.send(run)
    except StopIteration as done:
        return done.value


def _screen_pass(
    text: str, model: str, timeout_seconds: float, check_phrases: bool, max_characters: int,
) -> Generator[tuple[str, float], Any, ScreenOutcome]:
    """Own one shared policy; sync and async drivers only execute yielded provider work."""
    text = mask_outbound(text)
    size = load_settings().user_text_screen_chunk_size
    session = current_session()
    key = (text, model, check_phrases, size, max_characters)
    if session is not None and key in session.decisions:
        # Reuse is not a new billable call.
        return session.decisions[key]._replace(usage=None, model=None)
    outcome = yield from _screen_chunks(
        text, model, timeout_seconds, check_phrases, size, max_characters,
    )
    if session is not None:
        session.decisions[key] = outcome
        if outcome.allowed:
            session.allowed_sources.add(text)
    return outcome


def _screen_chunks(text, model, timeout_seconds, check_phrases, size, max_characters):
    """Visit every character once per pass, with intentional 300-character boundary overlap."""
    if not text.strip():
        return ScreenOutcome(allowed=True)
    if len(text) > max_characters:
        return ScreenOutcome(allowed=False, too_long=True)
    if check_phrases and has_obvious_instruction_override(text):
        return ScreenOutcome(allowed=False)
    if not os.environ.get("TYPESAFE_API_KEY", "").strip():
        logger.warning("TYPESAFE_API_KEY is unset; leaving user text out of the prompt")
        return ScreenOutcome(allowed=False, unchecked=True)
    deadline = monotonic() + timeout_seconds
    if (session := current_session()) is not None:
        deadline = min(deadline, session.deadline)
    usage = RunUsage()
    reported_model = None
    for start in range(0, len(text), size - 300):
        try:
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise TimeoutError("Screening deadline exceeded")
            run = yield text[start:start + size], remaining
        except UsageLimitExceeded:
            raise
        except Exception:
            logger.exception("Jev screen failed; leaving the text out of the prompt")
            return ScreenOutcome(False, usage if reported_model else None, reported_model, unchecked=True)
        usage.incr(run.usage)
        reported_model = reported_model_name(run.model_name, model)
        if blocks_on_yes_confidence(run.screen, run.confidence):
            return ScreenOutcome(False, usage, reported_model)
        if start + size >= len(text):
            break
    return ScreenOutcome(True, usage, reported_model)
