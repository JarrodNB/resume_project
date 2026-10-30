"""Run real interviews with bounded context and accounted providers.

Rails supplies accepted public dialogue and persists field approvals. The runtime uses
fixed accounted providers with configurable Luna reasoning, preserving Rails ownership
of acceptance and progression.
"""

import asyncio
import hashlib
import json
from contextlib import contextmanager
from datetime import UTC, datetime

import logfire
from pydantic_ai.exceptions import ModelAPIError, UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.usage import UsageLimits

from agents.interview_preparation_agent import make_preparer
from agents.spoken_interviewer_agent import make_interviewer
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
from interviews.settings import InterviewThinkingSettings
from privacy.contact_mask import contact_scope, mask_outbound
from privacy.known_contact import KnownContact
from prompts.interview_preparation_instructions import INTERVIEW_PREPARATION_PROMPT_VERSION
from prompts.interview_style import interview_style
from prompts.spoken_interviewer_instructions import SPOKEN_INTERVIEW_PROMPT_VERSION
from screening.conversation import screen_with_operation_models
from screening.prompt_guardrail import screening_failure_code
from screening.record_adapters import interview_source_records
from screening.records import screen_records
from screening.session import screening_session
from telemetry.privacy import telemetry_scope
from telemetry.tracing import record_prompt_version
from text_limits import MAX_PROMPT_TEXT, MAX_SCREENED_TEXT


class RealInterviewExecutor(InterviewExecutor):
    """Accept fixed approved providers explicitly; never resolve them in fake execution."""

    def __init__(self, client, *, audio, models, **kwargs):
        super().__init__(client, **kwargs)
        self.audio, self.models = audio, models
        self.thinking = InterviewThinkingSettings()

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

    async def execute(self, claim, *, deadline_managed=False):
        """Standalone calls own their timeout; the shared runner supplies it otherwise."""
        if claim.execution_mode != "real":
            raise ValueError("Real executor requires a real claim")
        try:
            remaining = min((claim.execution_deadline - datetime.now(UTC)).total_seconds(), 120)
            if remaining <= 0:
                raise TimeoutError
            async with asyncio.timeout(None if deadline_managed else remaining):
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
        outcome = await screen_with_operation_models(
            text, 120, lambda model: self.models.accounted(self.client, claim, "screening", model))
        if not outcome.allowed:
            raise ScreeningRejected(screening_failure_code(outcome))

    def _interviewer(self, claim, guard, *, system_prompt=""):
        return make_interviewer(guard, system_prompt=system_prompt), {
            "model": self.models.accounted(self.client, claim, "interviewer", "gpt-6-luna"),
            "model_settings": {"thinking": self.thinking.interview_dialogue_thinking, "max_tokens": 1024},
        }

    def _preparer(self, claim, guard, *, system_prompt=""):
        return make_preparer(guard, system_prompt=system_prompt, question_count=claim.payload.setup.question_count,
            question_format=claim.payload.setup.question_format, saved_job="job" in claim.payload.frozen_context), {
            "model": self.models.accounted(self.client, claim, "interviewer", "gpt-6-luna"),
            "model_settings": {"thinking": self.thinking.interview_preparation_thinking, "max_tokens": 4096},
        }


    async def _approve_library(self, claim, context, *, include_focus=False):
        sources = context.get("sources", [])
        if not isinstance(sources, list):
            raise ValueError("Invalid frozen career sources")  # noqa: TRY004 - malformed claims fail as domain input
        pending = [index for index, source in enumerate(sources)
                   if isinstance(source, dict) and source.get("screened") is not True]
        focus = context.get("career_focus") if include_focus else None
        focus_digest = None
        if isinstance(focus, str) and focus:
            if len(focus) > MAX_SCREENED_TEXT:
                raise ScreeningRejected("context_limit")
            digest = hashlib.sha256(json.dumps(focus, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
            if context.get("screened_career_focus_sha256") != digest:
                focus_digest = digest

        async def classify(text):
            return await screen_with_operation_models(text, 120,
                lambda model: self.models.accounted(self.client, claim, "screening", model))
        if sources:
            outcome = await screen_records(interview_source_records(sources),
                approved_sources=[source["text"] for source in sources], screen=classify)
            if not outcome.allowed:
                raise ScreeningRejected(screening_failure_code(outcome.decision))
        if focus_digest is not None:
            await self._screen(claim, mask_outbound(data_block("career_focus", focus)))
        if focus_digest is not None:
            # Focus-only checks also need a durable receipt before preparation.
            await self.client.screen_library(claim, pending, career_focus_sha256=focus_digest)
        elif pending:
            # Durable approval must succeed before the library can reach generation.
            await self.client.screen_library(claim, pending)

    async def _preparation(self, claim):
        context = claim.payload.frozen_context
        with screening_session(120):
            formatted = system_context(context) + "\n\n" + interview_style(claim.payload.setup)
            if len(formatted) > MAX_PROMPT_TEXT:
                raise ScreeningRejected("context_limit")
            await self._approve_library(claim, context, include_focus=True)
            if "job" in context:
                prompt = f"Prepare exactly {claim.payload.setup.question_count} main questions for the saved job in the system context. The output role must be null."
            else:
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
        formatted = system_context(context, role) + "\n\n" + interview_style(payload.setup)
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
        # Spoken turns deliberately skip injection classifiers. Keep exact-input
        # integrity, contact masking, context bounds and accounted model execution.
        prompt = data_block("candidate_answer", mask_outbound(transcript))

        async def guard(ctx, final_prompt):
            if final_prompt != prompt:
                raise ValueError("Interview input changed")
            return True

        agent, options = self._interviewer(claim, guard, system_prompt=formatted)
        result = await agent.run(prompt, message_history=history,
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
