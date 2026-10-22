"""Run real interviews with approved frozen context and newest-message screening.

Rails supplies accepted public dialogue and persists field approvals. The runtime uses
fixed accounted providers, preserving Rails ownership of acceptance and progression.
"""

import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime

import logfire
from pydantic_ai.exceptions import ModelAPIError, UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.usage import UsageLimits

from agents.interview_preparation_agent import make_preparer
from agents.spoken_interviewer_agent import make_interviewer
from agents.user_text_fallback_agent import screen_fallback_message_async, user_text_fallback_agent
from agents.user_text_screen_agent import screen_user_message_async, user_text_screen_agent
from interviews.audio_providers import ProviderError
from interviews.client import RailsClientError
from interviews.conversation import (
    ContextLimitExceeded,
    conversation_history,
    data_block,
    earlier_context,
    enforce_context_limit,
    system_context,
)
from interviews.executor import MAX_TRANSCRIPT_CHARACTERS, InterviewExecutor, ScreeningRejected
from interviews.history import serialize_history
from interviews.media import download_audio
from prompts.interview_preparation_instructions import INTERVIEW_PREPARATION_PROMPT_VERSION
from prompts.spoken_interviewer_instructions import SPOKEN_INTERVIEW_PROMPT_VERSION
from screening.conversation import screen_conversation_turn
from screening.screen_user_text import screen_user_text_async
from screening.session import screening_session
from text_limits import MAX_PROMPT_TEXT
from worker.contact_mask import contact_scope, mask_outbound
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
        context = (claim.payload.personal_evidence() if claim.kind == "turn"
                   else getattr(claim.payload, "frozen_context", {}))
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
        except ContextLimitExceeded:
            await self.client.fail(claim, "context_limit", False)
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

    def _interviewer(self, claim, guard, *, system_prompt=""):
        return make_interviewer(guard, system_prompt=system_prompt), {
            "model": self.models.accounted(self.client, claim, "interviewer", "gpt-6-luna"),
            "model_settings": {"thinking": "low", "max_tokens": 1024},
        }

    def _preparer(self, claim, guard, *, system_prompt=""):
        return make_preparer(guard, system_prompt=system_prompt, question_count=claim.payload.setup.question_count,
            question_format=claim.payload.setup.question_format), {
            "model": self.models.accounted(self.client, claim, "interviewer", "gpt-6-luna"),
            "model_settings": {"thinking": "low", "max_tokens": 4096},
        }


    async def _approve_library(self, claim, context, *, include_focus=False):
        sources = context.get("sources", [])
        if not isinstance(sources, list):
            raise ValueError("Invalid frozen career sources")  # noqa: TRY004 - malformed claims fail as domain input
        pending = [index for index, source in enumerate(sources)
                   if isinstance(source, dict) and source.get("screened") is not True]
        texts = []
        for index in pending:
            text = sources[index].get("text")
            if not isinstance(text, str):
                raise ValueError("Invalid frozen career source")  # noqa: TRY004 - malformed claims fail as domain input
            texts.append(data_block("unchecked_library_field", text))
        focus = context.get("career_focus") if include_focus else None
        if isinstance(focus, str) and focus:
            texts.append(data_block("career_focus", focus))
        if texts:
            await self._screen(claim, mask_outbound("\n\n".join(texts)))
        if pending:
            # Durable approval must succeed before the library can reach generation.
            await self.client.screen_library(claim, pending)

    async def _preparation(self, claim):
        context = claim.payload.frozen_context
        with screening_session(120):
            formatted = system_context(context)
            if len(formatted) > MAX_PROMPT_TEXT:
                raise ScreeningRejected("context_limit")
            await self._approve_library(claim, context, include_focus=True)
            prompt = f"Prepare the fictional role and exactly {claim.payload.setup.question_count} main questions from the career evidence in the system context."
            async def guard(ctx, final_prompt):
                if final_prompt != prompt:
                    raise ValueError("Preparation input changed")
                return True
            agent, options = self._preparer(claim, guard, system_prompt=formatted)
            result = await agent.run(prompt, usage_limits=UsageLimits(request_limit=2), **options)
            output = result.output.model_dump(mode="json")
        await self._reconcile(claim, lambda: self.client.accept_preparation(claim, **output))

    async def _turn(self, claim):
        payload = claim.payload
        context = payload.personal_evidence()
        role = payload.interview_context.fictional_role if payload.interview_context else None
        with screening_session(120):
            formatted = system_context(context, role)
            previous = earlier_context(payload)
            if previous:
                formatted += "\n\n" + previous
            history = conversation_history(payload, formatted)
            if len(formatted) > MAX_PROMPT_TEXT:
                raise ScreeningRejected("context_limit")
            enforce_context_limit(history, "")
            transcript = payload.candidate_transcript
            if payload.transcription_mode != "typed":
                grant = await self.client.recording(claim)
                data = await asyncio.to_thread(download_audio, grant["download_url"],
                    expected_checksum=grant["checksum"], expected_byte_size=grant["byte_size"], **self._media_options())
                if transcript is None:
                    transcript = await self._transcribe(claim, data)
            if not isinstance(transcript, str) or not transcript.strip():
                raise ScreeningRejected("empty_audio")
            if len(transcript) > MAX_TRANSCRIPT_CHARACTERS:
                raise ScreeningRejected("transcript_too_long")
            enforce_context_limit(history, data_block("candidate_answer", mask_outbound(transcript)))
            await self._approve_library(claim, context)
            turn = await screen_conversation_turn(transcript,
                screen=lambda text: self._screen(claim, text),
                render=lambda text: data_block("candidate_answer", text))
            enforce_context_limit(history, turn.prompt)
            agent, options = self._interviewer(claim, turn.guard, system_prompt=formatted)
            result = await agent.run(turn.prompt, message_history=history,
                usage_limits=UsageLimits(request_limit=3, tool_calls_limit=2), **options)
            saved = serialize_history(result.all_messages())
        async def accept():
            return await self.client.accept(claim, transcript=transcript, decision=result.output.decision,
                reply=result.output.reply, acknowledgement=result.output.acknowledgement, history_version=1, model_history=saved)
        await self._reconcile(claim, accept)

    async def _synthesize(self, claim):
        try:
            return await self.audio.speak(claim, claim.payload.text)
        except ProviderError as error:
            raise ScreeningRejected(str(error)) from None
