"""Run one fenced offline interview operation without owning durable state.

Rails grants media access and accepts results. Each local fake provider stage reports
explicit zero cost; speech uses saved text and never runs interviewer reasoning again.
"""

import asyncio
import base64
import hashlib
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

from pydantic_ai.messages import ModelRequest, UserPromptPart
from pydantic_ai.usage import RunUsage, UsageLimits
from pydantic_ai_harness import InputBlocked

from agents.user_text_screen_agent import UserTextScreenRun
from interviews.client import RailsTransportError
from interviews.fake import SCENARIOS, TRANSCRIPT, make_agent, speech_bytes
from interviews.history import restore_history, serialize_history
from interviews.media import MediaError, download_audio, upload_audio
from schemas.user_text_screen import UserTextScreen
from screening.prompt_guardrail import _input_parts
from screening.screen_user_text import screen_user_text_async
from screening.session import bind_screened_prompt, prompt_is_covered, screening_session
from text_limits import MAX_PROMPT_TEXT
from worker.contact_mask import contact_scope, covered_prompt_length, mask_outbound
from worker.known_contact import KnownContact

# Match Rails TextLimits::PROSE, the durable accepted transcript field limit.
MAX_TRANSCRIPT_CHARACTERS = 4_000


class ScreeningRejected(ValueError):
    """A required source was rejected before interviewer execution."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


class InterviewExecutor:
    """Execute a canonical claim with fake-only providers and scoped storage access."""

    def __init__(self, client, *, storage_client, allowed_origins: set[str],
                 allow_http=False, scenario="normal"):
        if scenario not in SCENARIOS:
            raise ValueError("Unknown fake scenario")
        self.client = client
        self.storage_client = storage_client
        self.allowed_origins = allowed_origins
        self.allow_http = allow_http
        self.scenario = scenario

    @asynccontextmanager
    async def _stage(self, claim, stage):
        identity = str(uuid4())
        await self.client.start_provider(claim, identity, stage, "fake", f"fake-{stage}-v1")
        try:
            yield
        finally:
            # Fake execution cannot incur provider charges, even when local work fails.
            await self.client.usage(claim, [{"cost_microdollars": 0}], observation_id=identity)

    async def execute(self, claim):
        """Run one operation; fail safe domain errors, leaving transport loss recoverable."""
        finished = False
        try:
            if claim.kind == "turn":
                await self._turn(claim)
            else:
                await self._speech(claim)
            finished = True
        except ScreeningRejected as error:
            await self.client.fail(claim, error.code, error.code == "screening_unavailable")
            finished = True
        except MediaError as error:
            await self.client.fail(claim, error.code, error.code == "storage_unavailable")
            finished = True
        except (ValueError, InputBlocked):
            await self.client.fail(claim, "execution_failed" if claim.kind == "turn" else "speech_failed", False)
            finished = True
        finally:
            await self.client.usage(claim, [], incomplete=not finished)

    def _media_options(self):
        return {"client": self.storage_client, "allowed_origins": self.allowed_origins,
                "allow_http": self.allow_http}

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
            raise ScreeningRejected("screening_unavailable" if outcome.unchecked else
                                    "context_limit" if outcome.too_long else "screening_blocked")

    async def _turn(self, claim):
        payload = claim.payload
        history = restore_history(payload.history_version, payload.model_history)
        grant = await self.client.recording(claim)
        await asyncio.to_thread(download_audio, grant["download_url"],
                                expected_checksum=grant["checksum"],
                                expected_byte_size=grant["byte_size"], **self._media_options())
        async with self._stage(claim, "transcription"):
            transcript = TRANSCRIPT if self.scenario != "oversized" else "x" * 300000
        if len(transcript) > MAX_TRANSCRIPT_CHARACTERS:
            raise ScreeningRejected("transcript_too_long")
        contact = KnownContact.from_values(**{
            key: payload.fixture_context.get(key, []) for key in ("names", "emails", "phones")
        })
        with contact_scope(contact), screening_session(120):
            source = mask_outbound(json.dumps({"question": payload.question,
                "fixture_context": payload.fixture_context, "transcript": transcript}, sort_keys=True))
            input_texts = _input_parts(SimpleNamespace(messages=[*history, ModelRequest(parts=[UserPromptPart(source)])]), source)
            if sum(covered_prompt_length(text) for text in input_texts) + len(input_texts) * 2 > MAX_PROMPT_TEXT:
                raise ScreeningRejected("context_limit")
            await self._screen(claim, source)
            prompt = bind_screened_prompt([source], lambda sources: sources[0])

            async def guard(ctx, final_prompt):
                inputs = _input_parts(ctx, final_prompt)
                if sum(covered_prompt_length(text) for text in inputs) + len(inputs) * 2 > MAX_PROMPT_TEXT:
                    raise ScreeningRejected("context_limit")
                for text in inputs:
                    if not prompt_is_covered(text):
                        await self._screen(claim, text)
                return True

            async def provider_call(function):
                async with self._stage(claim, "interviewer"):
                    return function()

            agent = make_agent(self.scenario, guard, provider_call)
            result = await agent.run(prompt, message_history=history,
                                     usage_limits=UsageLimits(request_limit=3, tool_calls_limit=2))
            saved = serialize_history(result.all_messages())
        async def accept():
            return await self.client.accept(claim, transcript=transcript, decision=result.output.decision,
                                            reply=result.output.reply, history_version=1, model_history=saved)
        await self._reconcile(claim, accept)

    async def _speech(self, claim):
        async with self._stage(claim, "speech"):
            data = speech_bytes(claim.payload.text)
        reservation = await self.client.reserve_audio(claim, "audio/wav")
        await asyncio.to_thread(upload_audio, reservation["upload_url"], data,
                                content_type="audio/wav", headers=reservation["headers"],
                                **self._media_options())
        checksum = base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode()
        await self.client.register_audio(claim, reservation["media_id"], checksum, len(data))
        await self._reconcile(claim, lambda: self.client.complete_audio(claim, reservation["media_id"]))

    async def _reconcile(self, claim, callback):
        """Resolve a lost result receipt through canonical state before replaying it."""
        try:
            await callback()
        except RailsTransportError:
            status = await self.client.status(claim.operation_id)
            if status.status != "accepted":
                await callback()
