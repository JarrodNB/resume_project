"""Decide whether protected input can enter generation with Jev or local Llama.

JEV gets at most three seconds per chunk. An attempted failure uses a boolean fallback
within the remaining source/task deadline. Missing credentials and unsuccessful screening
stay unavailable; limits and external cancellation propagate. Completed model usage is
kept separately per provider, including chunks before a later block or outage. Local
Llama inference detects prompt injection only and has no billed provider usage.
"""

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable, Generator
from contextlib import nullcontext
from time import monotonic
from typing import Any, NamedTuple

import logfire
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import RunUsage

from agents.user_text_fallback_agent import screen_fallback_message, screen_fallback_message_async
from agents.user_text_screen_agent import JEV_REQUEST_TIMEOUT_SECONDS, screen_user_message
from conversation_logging import fallback_execution
from screening import local_llama
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
    """Return a decision from the selected classifier, failing closed on outages.

    Unavailable screening returns unchecked; request, tool-call, or token caps propagate.
    `check_phrases` is for a short note. A whole resume skips the phrase prefilter.
    Trusted import code may adjust `max_characters` after validating original text:
    privacy placeholders expand the protected text, but every character is still screened.
    """
    if model == local_llama.MODEL:
        return _local_screen(text, model, timeout_seconds, check_phrases, max_characters)
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
    credentials_available: bool | None = None,
    classify_fallback: Callable[[str, str, float], Awaitable[Any]] | None = None,
) -> ScreenOutcome:
    """Apply the same policy without blocking an agent's running event loop.

    The classifier is a provider seam, not an approval: every returned decision still
    goes through confidence, fail-closed, cap, cache, and usage processing below.
    Offline adapters can supply credential availability and a local fallback; defaults
    preserve the production credential check and remote fallback. These seams never
    create an allowed decision themselves.
    """
    session = current_session()
    if session is None:
        return await _drive_async(
            text, model, timeout_seconds, check_phrases, max_characters, classify,
            credentials_available, classify_fallback,
        )
    # The same execution can be used by successive asyncio.run calls. Locks belong to
    # their event loop; completed decisions remain shared across those loops.
    key = (asyncio.get_running_loop(), *_screen_key(text, model, check_phrases, max_characters))
    lock = session.async_locks.setdefault(key, asyncio.Lock())
    async with lock:
        return await _drive_async(
            text, model, timeout_seconds, check_phrases, max_characters, classify,
            credentials_available, classify_fallback,
        )


async def _drive_async(
    text, model, timeout_seconds, check_phrases, max_characters, classify,
    credentials_available, classify_fallback,
):
    """Drive the common policy after acquiring execution-local source ownership."""
    if model == local_llama.MODEL:
        session = current_session()
        remaining = min(timeout_seconds, session.deadline - monotonic()) if session else timeout_seconds
        if remaining <= 0:
            result = ScreenOutcome(False, unchecked=True)
        else:
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(_local_screen, text, model, remaining, check_phrases,
                                      max_characters, False),
                    timeout=remaining,
                )
            except TimeoutError:
                result = ScreenOutcome(False, unchecked=True)
        # A timed-out thread can finish later. Only this event-loop owner may cache
        # approval, and only after it has completed inside the caller's deadline.
        if session is not None:
            masked = mask_outbound(text)
            session.decisions[_screen_key(masked, model, check_phrases, max_characters)] = result
            if result.allowed:
                session.allowed_sources.add(masked)
        return result
    screening = _screen_pass(text, model, timeout_seconds, check_phrases, max_characters,
                             credentials_available=credentials_available)
    try:
        chunk, timeout, fallback = next(screening)
        while True:
            try:
                if fallback:
                    selected = load_settings().user_text_screen_fallback_model
                    with fallback_execution(model, selected, kind="screening"):
                        run = await (classify_fallback or screen_fallback_message_async)(
                            chunk, selected, timeout,
                        )
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
    policy = ((local_llama.TARGET_CHARACTERS, local_llama.OVERLAP, local_llama.MAX_TOKENS)
              if model == local_llama.MODEL else (load_settings().user_text_screen_chunk_size, 300))
    return (mask_outbound(text), model, check_phrases, policy, max_characters)


def _local_screen(text, model, timeout_seconds, check_phrases, max_characters, cache_result=True):
    """Apply the same fail-closed contract to local inference and cache exact decisions."""
    text = mask_outbound(text)
    session = current_session()
    key = _screen_key(text, model, check_phrases, max_characters)
    if session is not None and key in session.decisions:
        return session.decisions[key]
    if not text.strip():
        result = ScreenOutcome(True)
    elif len(text) > max_characters:
        result = ScreenOutcome(False, too_long=True)
    elif check_phrases and has_obvious_instruction_override(text):
        result = ScreenOutcome(False)
    else:
        deadline = monotonic() + timeout_seconds
        if session is not None:
            deadline = min(deadline, session.deadline)
        try:
            chunks = list(local_llama.iter_chunks(text))
            result = ScreenOutcome(True)
            for index, (chunk, token_count) in enumerate(chunks):
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise TimeoutError("Local screening deadline exceeded")
                run = local_llama.classify_chunk(chunk, model, remaining)
                with logfire.span("local_prompt_screen", model=model, chunk_index=index,
                                  chunk_count=len(chunks),
                                  character_count=len(chunk), token_count=token_count,
                                  blocked=run.blocked, duration_seconds=run.duration):
                    pass
                if run.blocked:
                    result = ScreenOutcome(False)
                    break
        except Exception as error:  # noqa: BLE001 — unavailable local inference fails closed
            with logfire.span("local_prompt_screen_error", model=model,
                              error_category=type(error).__name__):
                pass
            logger.warning("Local prompt screening unavailable: %s", type(error).__name__)
            result = ScreenOutcome(False, unchecked=True)
    if session is not None and cache_result:
        session.decisions[key] = result
        if result.allowed:
            session.allowed_sources.add(text)
    return result


def _screen_pass(
    text: str, model: str, timeout_seconds: float, check_phrases: bool, max_characters: int,
    *, credentials_available: bool | None = None,
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
        text, model, timeout_seconds, check_phrases, size, max_characters, credentials_available,
    )
    if session is not None:
        session.decisions[key] = outcome
        if outcome.allowed:
            session.allowed_sources.add(text)
    return outcome


def _screen_chunks(
    text, model, timeout_seconds, check_phrases, size, max_characters, credentials_available=None,
):
    """Visit every character once per pass, with intentional 300-character boundary overlap."""
    if not text.strip():
        return ScreenOutcome(allowed=True)
    if len(text) > max_characters:
        return ScreenOutcome(allowed=False, too_long=True)
    if check_phrases and has_obvious_instruction_override(text):
        return ScreenOutcome(allowed=False)
    available = (os.environ.get("TYPESAFE_API_KEY", "").strip()
                 if credentials_available is None else credentials_available)
    if not available:
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
