"""Execute screened real turns through the same storage/history/acceptance pipeline.

The dedicated real runtime injects fixed, accounted providers.
Rails owns durable state and per-request accounting; this layer never chooses progression.
"""

import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime

import logfire
from pydantic_ai.exceptions import ModelAPIError, UnexpectedModelBehavior, UsageLimitExceeded

from agents.interview_preparation_agent import make_preparer
from agents.spoken_interviewer_agent import make_interviewer
from agents.user_text_fallback_agent import screen_fallback_message_async, user_text_fallback_agent
from agents.user_text_screen_agent import screen_user_message_async, user_text_screen_agent
from interviews.audio_providers import ProviderError
from interviews.client import RailsClientError
from interviews.executor import InterviewExecutor, ScreeningRejected
from prompts.interview_preparation_instructions import INTERVIEW_PREPARATION_PROMPT_VERSION
from prompts.spoken_interviewer_instructions import SPOKEN_INTERVIEW_PROMPT_VERSION
from screening.screen_user_text import screen_user_text_async
from worker.contact_mask import contact_scope
from worker.known_contact import KnownContact
from worker.telemetry_privacy import telemetry_scope
from worker.tracing import record_prompt_version


class RealInterviewExecutor(InterviewExecutor):
    """Accept fixed approved providers explicitly; never resolve them in fake execution."""

    def __init__(self, client, *, audio, models, **kwargs):
        super().__init__(client, **kwargs)
        self.audio, self.models = audio, models

    @contextmanager
    def _trace(self, claim):
        context = getattr(claim.payload, "frozen_context", getattr(claim.payload, "fixture_context", {}))
        contact = KnownContact.from_values(**{
            key: context.get(key, []) for key in ("names", "emails", "phones")
        })
        with contact_scope(contact), telemetry_scope(interview_operation_id=claim.operation_id), logfire.span(
            "interview.operation", operation_kind=claim.kind
        ):
            yield

    async def execute(self, claim):
        if claim.execution_mode != "real":
            raise ValueError("Real executor requires a real claim")
        try:
            remaining = min((claim.execution_deadline - datetime.now(UTC)).total_seconds(), 120)
            if remaining <= 0:
                raise TimeoutError
            async with asyncio.timeout(remaining):
                version = INTERVIEW_PREPARATION_PROMPT_VERSION if claim.kind == "preparation" else SPOKEN_INTERVIEW_PROMPT_VERSION
                with self._trace(claim), record_prompt_version(version):
                    await super().execute(claim)
        except ModelAPIError:
            await self.client.fail(claim, "dependency_unavailable", True)
        except TimeoutError:
            await self.client.fail(claim, "execution_timeout", True)
        except (UnexpectedModelBehavior, UsageLimitExceeded):
            await self.client.fail(claim, "execution_failed", False)
        except RailsClientError:
            # A lost lease or rejected admission cannot dispatch another provider.
            # Preserve its original durable reservation; the runtime reconciles state.
            raise

    async def _transcribe(self, claim, data):
        try:
            return await self.audio.transcribe(claim, data)
        except ProviderError as error:
            raise ScreeningRejected(str(error)) from None

    async def _screen(self, claim, text):
        async def classify(chunk, model, timeout):
            with user_text_screen_agent.override(
                model=self.models.accounted(self.client, claim, "screening", "jev-1.13.0")
            ):
                return await screen_user_message_async(chunk, model, timeout)

        async def fallback(chunk, model, timeout):
            # Shared policy chooses fallback only after attempted Jev failure.
            if model != "openai:gpt-5-nano":
                raise ValueError("Unsupported interview screening fallback")
            with user_text_fallback_agent.override(
                model=self.models.accounted(self.client, claim, "screening", "gpt-5-nano")
            ):
                return await screen_fallback_message_async(chunk, model, timeout)

        outcome = await screen_user_text_async(text, "typesafe:jev-1.13.0", 120,
                                               classify=classify, classify_fallback=fallback)
        if not outcome.allowed:
            raise ScreeningRejected("screening_unavailable" if outcome.unchecked else
                                    "context_limit" if outcome.too_long else "screening_blocked")

    def _interviewer(self, claim, guard):
        return make_interviewer(guard), {
            "model": self.models.accounted(self.client, claim, "interviewer", "gpt-6-luna"),
            "model_settings": {"thinking": "low", "max_tokens": 1024},
        }

    def _preparer(self, claim, guard):
        return make_preparer(guard), {
            "model": self.models.accounted(self.client, claim, "interviewer", "gpt-6-luna"),
            "model_settings": {"thinking": "low", "max_tokens": 4096},
        }

    async def _synthesize(self, claim):
        try:
            return await self.audio.speak(claim, claim.payload.text)
        except ProviderError as error:
            raise ScreeningRejected(str(error)) from None
