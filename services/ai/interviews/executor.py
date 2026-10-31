"""Run one fenced interview operation without owning durable state.

Rails grants media access and accepts results. Provider hooks share validation, history,
screening and acceptance. Default fake stages report explicit zero cost; real turns inject
accounted providers. Speech uses saved text and never runs interviewer reasoning again.
"""

import asyncio
import base64
import hashlib
from contextlib import asynccontextmanager
from uuid import uuid4

from psycopg import OperationalError
from pydantic_ai.usage import RunUsage, UsageLimits
from pydantic_ai_harness import InputBlocked

from agents.user_text_screen_agent import UserTextScreenRun
from interviews.client import RailsTransportError
from interviews.conversation import (
    ContextLimitExceeded,
    conversation_history,
    data_block,
    earlier_context,
    enforce_context_limit,
    system_context,
)
from interviews.fake import SCENARIOS, TRANSCRIPT, make_agent, speech_bytes
from interviews.media import MediaError, download_audio, upload_audio
from interviews.timing import stage_timing
from privacy.contact_mask import contact_scope, covered_prompt_length, mask_outbound
from privacy.known_contact import KnownContact
from schemas.user_text_screen import UserTextScreen
from screening.prompt_guardrail import prompt_input_texts, screening_failure_code
from screening.screen_user_text import screen_user_text_async
from screening.session import bind_screened_prompt, prompt_is_covered, screening_session
from text_limits import MAX_PROMPT_TEXT

# Match Rails TextLimits::PROSE, the durable accepted transcript field limit.
MAX_TRANSCRIPT_CHARACTERS = 4_000


class ScreeningRejected(ValueError):
    """A required source was rejected before interviewer execution."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


class InterviewExecutor:
    """Execute a canonical claim with scoped storage and replaceable provider stages."""

    def __init__(self, client, *, storage_client, allowed_origins: set[str],
                 allow_http=False, scenario="normal", input_reader=None):
        if scenario not in SCENARIOS:
            raise ValueError("Unknown fake scenario")
        self.client = client
        self.storage_client = storage_client
        self.allowed_origins = allowed_origins
        self.allow_http = allow_http
        self.scenario = scenario
        self.input_reader = input_reader

    @asynccontextmanager
    async def _stage(self, claim, stage):
        identity = str(uuid4())
        await self.client.start_provider(claim, identity, stage, "fake", f"fake-{stage}-v1")
        try:
            yield
        finally:
            # Fake execution cannot incur provider charges, even when local work fails.
            await self.client.usage(claim, [{"cost_microdollars": 0}], observation_id=identity)

    async def execute(self, claim, *, deadline_managed=False):
        """Run one operation; fail safe domain errors, leaving transport loss recoverable."""
        finished = False
        try:
            from interviews.client import ReferencePayload
            if isinstance(claim.payload, ReferencePayload):
                if self.input_reader is None:
                    from database.interview_inputs import build_interview_input_reader
                    from settings import AISettings
                    self.input_reader = build_interview_input_reader(AISettings())
                claim = await asyncio.to_thread(self.input_reader, claim)

            if claim.kind == "turn":
                await self._turn(claim)
            elif claim.kind == "transcription":
                await self._recorded_review(claim)
            elif claim.kind == "preparation":
                await self._preparation(claim)
            else:
                await self._speech(claim)
            finished = True
        except ContextLimitExceeded:
            await self.client.fail(claim, "context_limit", False)
            finished = True
        except OperationalError:
            await self.client.fail(claim, "dependency_unavailable", True)
            finished = True
        except ScreeningRejected as error:
            failure = "speech_failed" if claim.kind == "speech" else "execution_failed"
            code = {"provider_unavailable": "dependency_unavailable", "unusable_audio": "empty_audio",
                    "invalid_provider_response": failure, "provider_response_too_large": failure,
                    "invalid_speech_text": "speech_failed", "unknown_provider_usage": failure}.get(error.code, error.code)
            await self.client.fail(claim, code, code in {"screening_unavailable", "dependency_unavailable"})
            finished = True
        except MediaError as error:
            await self.client.fail(claim, error.code, error.code == "storage_unavailable")
            finished = True
        except (ValueError, InputBlocked):
            await self.client.fail(claim, "speech_failed" if claim.kind == "speech" else "execution_failed", False)
            finished = True
        finally:
            await self.client.usage(claim, [], incomplete=not finished)

    def _media_options(self):
        return {"client": self.storage_client, "allowed_origins": self.allowed_origins,
                "allow_http": self.allow_http}

    def _preparer(self, claim, guard):
        raise ValueError("Preparation requires explicitly configured real providers")

    async def _preparation(self, claim):
        raise ValueError("Preparation requires explicitly configured real providers")

    async def _screen(self, claim, text):
        async def classify(chunk, model, timeout):
            async with self._stage(claim, "screening"):
                return UserTextScreenRun(
                    UserTextScreen(prompt_injection=self.scenario == "blocked", harmful_request=False),
                    "jev-1.13.0", {"prompt_injection": 1.0, "harmful_request": 1.0}, RunUsage(),
                )
        async def unavailable_fallback(*args):
            raise RuntimeError("Offline fallback unavailable")

        outcome = await screen_user_text_async(
            text, "jev-1.13.0", 120, classify=classify,
            credentials_available=self.scenario != "unavailable",
            classify_fallback=unavailable_fallback,
        )
        if not outcome.allowed:
            raise ScreeningRejected(screening_failure_code(outcome))

    async def _transcribe(self, claim, data):
        async with self._stage(claim, "transcription"):
            return TRANSCRIPT if self.scenario != "oversized" else "x" * 300000

    def _interviewer(self, claim, guard):
        async def provider_call(function):
            async with self._stage(claim, "interviewer"):
                return function()
        return make_agent(self.scenario, guard, provider_call), {}

    async def _recorded_review(self, claim):
        grant = await self.client.recording(claim)
        data = await asyncio.to_thread(download_audio, grant["download_url"],
            expected_checksum=grant["checksum"], expected_byte_size=grant["byte_size"], **self._media_options())
        transcript = await self._transcribe(claim, data)
        if not isinstance(transcript, str) or not transcript.strip():
            raise ScreeningRejected("empty_audio")
        if len(transcript) > MAX_TRANSCRIPT_CHARACTERS:
            raise ScreeningRejected("transcript_too_long")
        await self._reconcile(claim, lambda: self.client.accept_transcription(claim, transcript))

    async def _turn(self, claim):
        payload = claim.payload
        if payload.earlier_dialogue is not None:
            size = sum(len(message.content) for group in payload.earlier_dialogue.groups for message in group.messages)
            if size > payload.earlier_dialogue.character_budget:
                raise ScreeningRejected("context_limit")
        transcript = payload.candidate_transcript
        if payload.transcription_mode != "typed":
            with stage_timing(claim, "recording_download"):
                grant = await self.client.recording(claim)
                data = await asyncio.to_thread(download_audio, grant["download_url"],
                                        expected_checksum=grant["checksum"],
                                        expected_byte_size=grant["byte_size"], **self._media_options())
            with stage_timing(claim, "transcription"):
                transcript = await self._transcribe(claim, data)
        if not isinstance(transcript, str) or not transcript.strip():
            raise ScreeningRejected("empty_audio")
        if len(transcript) > MAX_TRANSCRIPT_CHARACTERS:
            raise ScreeningRejected("transcript_too_long")
        contact = KnownContact.from_values(**{
            key: payload.personal_evidence().get(key, []) for key in ("names", "emails", "phones")
        })
        with contact_scope(contact), screening_session(120):
            formatted = system_context(payload.personal_evidence())
            previous = earlier_context(payload)
            if previous:
                formatted += "\n\n" + previous
            history = conversation_history(payload, formatted)
            source = data_block("candidate_answer", mask_outbound(transcript))
            enforce_context_limit(history, source)
            # Fixtures use the normal guard, but accepted dialogue comes only from
            # the owned reader, never saved provider envelopes or tool messages.
            with stage_timing(claim, "screening"):
                await self._screen(claim, formatted)
                await self._screen(claim, source)
            prompt = bind_screened_prompt([source], lambda sources: sources[0])

            async def guard(ctx, final_prompt):
                inputs = prompt_input_texts(ctx, final_prompt)
                if sum(covered_prompt_length(text) for text in inputs) + len(inputs) * 2 > MAX_PROMPT_TEXT:
                    raise ScreeningRejected("context_limit")
                for text in inputs:
                    if not prompt_is_covered(text):
                        with stage_timing(claim, "screening"):
                            await self._screen(claim, text)
                return True

            agent, options = self._interviewer(claim, guard)
            with stage_timing(claim, "interviewer"):
                result = await agent.run(prompt, message_history=history,
                                         usage_limits=UsageLimits(request_limit=3, tool_calls_limit=2), **options)
        async def accept():
            return await self.client.accept(claim, transcript=transcript, decision=result.output.decision,
                                            reply=result.output.reply, history_version=1, model_history=[])
        with stage_timing(claim, "acceptance"):
            await self._reconcile(claim, accept)

    async def _synthesize(self, claim):
        async with self._stage(claim, "speech"):
            return speech_bytes(claim.payload.text)

    async def _speech(self, claim):
        with stage_timing(claim, "speech_synthesis"):
            data = await self._synthesize(claim)
        with stage_timing(claim, "speech_storage"):
            reservation = await self.client.reserve_audio(claim, "audio/wav")
            await asyncio.to_thread(upload_audio, reservation["upload_url"], data,
                                    content_type="audio/wav", headers=reservation["headers"],
                                    **self._media_options())
            checksum = base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode()
            await self.client.register_audio(claim, reservation["media_id"], checksum, len(data))
        with stage_timing(claim, "acceptance"):
            await self._reconcile(claim, lambda: self.client.complete_audio(claim, reservation["media_id"]))

    async def _reconcile(self, claim, callback):
        """Resolve a lost result receipt through canonical state before replaying it."""
        try:
            await callback()
        except RailsTransportError:
            status = await self.client.status(claim.operation_id)
            if status.status != "accepted":
                await callback()
