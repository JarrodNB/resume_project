"""Decide whether protected input can enter generation, hiding screening recovery.

JEV gets at most three seconds per chunk. An attempted failure uses a boolean fallback
within the remaining source/task deadline. Missing credentials and unsuccessful screening
stay unavailable; limits and external cancellation propagate. Completed model usage is
kept separately per provider, including chunks before a later block or outage.
"""

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable, Generator
from contextlib import nullcontext
from time import monotonic
from typing import Any, NamedTuple

from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import RunUsage

from agents.user_text_fallback_agent import screen_fallback_message, screen_fallback_message_async
from agents.user_text_screen_agent import JEV_REQUEST_TIMEOUT_SECONDS, screen_user_message
from conversation_logging import fallback_execution
from screening.guardrail_usage import record_guardrail_usage
from screening.obvious_instruction_override import has_obvious_instruction_override
from screening.session import current_session
from screening.yes_confidence import blocks_on_yes_confidence
from text_limits import MAX_SCREENED_TEXT
from worker.contact_mask import mask_outbound
from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import ModelUsage
from worker.settings import load_settings

logger = logging.getLogger(__name__)


class ScreenOutcome(NamedTuple):
    """A decision and completed per-model usage. Legacy totals cover single-model passes.

    `too_long` and `unchecked` are unavailable checks, distinct from a safety rejection.
    Worker request accounting remains authoritative even when a run fails mid-validation.
    """

    allowed: bool
    usage: RunUsage | None = None
    model: str | None = None
    too_long: bool = False
    unchecked: bool = False
    completed_usage: tuple[ModelUsage, ...] = ()

    @property
    def model_usages(self) -> list[ModelUsage]:
        """Completed classifiers priced separately, with support for legacy single-model values."""
        if self.completed_usage:
            return list(self.completed_usage)
        if self.usage is not None and self.model is not None:
            return [build_model_usage(self.model, self.usage)]
        return []


def screen_user_text(
    text: str, model: str, timeout_seconds: float, *, check_phrases: bool = True,
    max_characters: int = MAX_SCREENED_TEXT,
) -> ScreenOutcome:
    """Return a decision after JEV and, on attempted failure, fallback screening.

    Unavailable screening returns unchecked; request, tool-call, or token caps propagate.
    `check_phrases` is for a short note. A whole resume skips the phrase prefilter.
    Trusted import code may adjust `max_characters` after validating original text:
    privacy placeholders expand the protected text, but every character is still screened.
    """
    screening = _screen_pass(text, model, timeout_seconds, check_phrases, max_characters)
    try:
        chunk, timeout, fallback = next(screening)
        while True:
            try:
                classifier = screen_fallback_message if fallback else screen_user_message
                selected = load_settings().user_text_screen_fallback_model if fallback else model
                with fallback_execution(model, selected, kind="screening") if fallback else nullcontext():
                    run = classifier(chunk, model=selected, timeout_seconds=timeout)
            except Exception as error:  # noqa: BLE001 — shared policy below logs and fails closed
                chunk, timeout, fallback = screening.throw(error)
            else:
                chunk, timeout, fallback = screening.send(run)
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
    session = current_session()
    if session is None:
        return await _drive_async(text, model, timeout_seconds, check_phrases, max_characters, classify)
    # The same execution can be used by successive asyncio.run calls. Locks belong to
    # their event loop; completed decisions remain shared across those loops.
    key = (asyncio.get_running_loop(), *_screen_key(text, model, check_phrases, max_characters))
    lock = session.async_locks.setdefault(key, asyncio.Lock())
    async with lock:
        return await _drive_async(text, model, timeout_seconds, check_phrases, max_characters, classify)


async def _drive_async(text, model, timeout_seconds, check_phrases, max_characters, classify):
    """Drive the common policy after acquiring execution-local source ownership."""
    screening = _screen_pass(text, model, timeout_seconds, check_phrases, max_characters)
    try:
        chunk, timeout, fallback = next(screening)
        while True:
            try:
                if fallback:
                    selected = load_settings().user_text_screen_fallback_model
                    with fallback_execution(model, selected, kind="screening"):
                        run = await screen_fallback_message_async(chunk, selected, timeout)
                else:
                    run = await classify(chunk, model, timeout)
                selected = load_settings().user_text_screen_fallback_model if fallback else model
                record_guardrail_usage(run.model_name, selected, run.usage)
            except Exception as error:  # noqa: BLE001 — shared policy below logs and fails closed
                chunk, timeout, fallback = screening.throw(error)
            else:
                chunk, timeout, fallback = screening.send(run)
    except StopIteration as done:
        return done.value


def _screen_key(text, model, check_phrases, max_characters):
    return (mask_outbound(text), model, check_phrases, load_settings().user_text_screen_chunk_size, max_characters)


def _screen_pass(
    text: str, model: str, timeout_seconds: float, check_phrases: bool, max_characters: int,
) -> Generator[tuple[str, float, bool], Any, ScreenOutcome]:
    """Own one shared policy; sync and async drivers only execute yielded provider work."""
    text = mask_outbound(text)
    size = load_settings().user_text_screen_chunk_size
    session = current_session()
    key = _screen_key(text, model, check_phrases, max_characters)
    if session is not None and key in session.decisions:
        # Reuse is not a new billable call.
        return session.decisions[key]._replace(usage=None, model=None, completed_usage=())
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
    completed_usage = []
    models = set()

    def outcome(allowed, *, unchecked=False):
        # Compatibility totals are meaningful only when all chunks used the same model.
        single = len(models) == 1
        return ScreenOutcome(
            allowed, usage if single else None, reported_model if single else None,
            unchecked=unchecked, completed_usage=tuple(completed_usage),
        )

    for start in range(0, len(text), size - 300):
        chunk = text[start:start + size]
        fallback = False
        try:
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise TimeoutError("Screening deadline exceeded")
            try:
                run = yield chunk, min(JEV_REQUEST_TIMEOUT_SECONDS, remaining), False
            except UsageLimitExceeded:
                raise
            except Exception:  # noqa: BLE001 — provider failures use the safety fallback
                # Only an attempted JEV failure triggers recovery. Missing credentials,
                # exhausted deadlines, external cancellation and limits never get here.
                fallback = True
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise TimeoutError("Screening deadline exceeded") from None
                run = yield chunk, remaining, True
        except UsageLimitExceeded:
            raise
        except Exception:
            logger.exception("Safety screening failed; leaving the text out of the prompt")
            return outcome(False, unchecked=True)
        usage.incr(run.usage)
        configured = load_settings().user_text_screen_fallback_model if fallback else model
        reported_model = reported_model_name(run.model_name, configured)
        models.add(reported_model)
        completed_usage.append(build_model_usage(reported_model, run.usage))
        blocked = run.screen.blocked if fallback else blocks_on_yes_confidence(run.screen, run.confidence)
        if blocked:
            return outcome(False)
        if start + size >= len(text):
            break
    return outcome(True)
