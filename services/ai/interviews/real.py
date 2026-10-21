"""Execute screened real turns through the same storage/history/acceptance pipeline.

This is an injectable executor, not a runtime switch. Public real admission stays closed.
Rails owns durable state and per-request accounting; this layer never chooses progression.
"""

import asyncio
from datetime import UTC, datetime

from pydantic_ai.exceptions import ModelAPIError, UnexpectedModelBehavior, UsageLimitExceeded

from agents.spoken_interviewer_agent import make_interviewer
from agents.user_text_fallback_agent import screen_fallback_message_async, user_text_fallback_agent
from agents.user_text_screen_agent import screen_user_message_async, user_text_screen_agent
from interviews.audio_providers import ProviderError
from interviews.client import RailsClientError
from interviews.executor import InterviewExecutor, ScreeningRejected
from prompts.spoken_interviewer_instructions import SPOKEN_INTERVIEW_PROMPT_VERSION
from screening.screen_user_text import screen_user_text_async
from worker.tracing import record_prompt_version


class RealInterviewExecutor(InterviewExecutor):
    """Accept fixed approved providers explicitly; never resolve them in fake execution."""

    def __init__(self, client, *, audio, models, **kwargs):
        super().__init__(client, **kwargs)
        self.audio, self.models = audio, models

    async def execute(self, claim):
        if claim.execution_mode != "real" or claim.kind != "turn":
            raise ValueError("Real turn executor requires a real turn claim")
        try:
            remaining = min((claim.execution_deadline - datetime.now(UTC)).total_seconds(), 120)
            if remaining <= 0:
                raise TimeoutError
            async with asyncio.timeout(remaining):
                with record_prompt_version(SPOKEN_INTERVIEW_PROMPT_VERSION):
                    await super().execute(claim)
        except (ModelAPIError, TimeoutError):
            await self.client.fail(claim, "provider_unavailable", True)
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
