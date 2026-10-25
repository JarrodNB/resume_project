"""Send bounded execution callbacks to the Rails owner of interview state.

Only the configured Rails origin receives the service credential. Storage grants
are data for the separate credential-free media client, never navigation targets.
"""

import asyncio
import json
from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote, urlsplit

import httpx
import logfire
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, model_validator

from schemas.interview_setup import InterviewSetup


class InterviewContext(BaseModel):
    """Keep owned frozen facts separate from the imagined vacancy."""

    version: Literal[1]
    personal_evidence: dict[str, Any]
    fictional_role: dict[str, Any]


class PublicMessage(BaseModel):
    """An accepted utterance, never a private model/tool message."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["opening", "answer", "follow_up"]
    content: str = Field(min_length=1)


class PublicQuestionGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_position: int = Field(ge=0)
    messages: list[PublicMessage] = Field(min_length=2, max_length=6)

    @model_validator(mode="after")
    def complete_dialogue(self):
        kinds = [message.kind for message in self.messages]
        if kinds[0] != "opening" or kinds[-1] != "answer" or any(
            kind != ("answer" if i % 2 else "follow_up") for i, kind in enumerate(kinds[1:], 1)
        ):
            raise ValueError("Incomplete public question group")
        return self


class EarlierDialogue(BaseModel):
    """Complete question groups selected by Rails under a content-character cap."""

    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    character_budget: Literal[12000]
    groups: list[PublicQuestionGroup] = Field(max_length=11)
    omitted_question_positions: list[int] = Field(max_length=11)

    @model_validator(mode="after")
    def chronological_groups(self):
        positions = [group.question_position for group in self.groups]
        omitted = self.omitted_question_positions
        if positions != sorted(set(positions)) or omitted != sorted(set(omitted)) or any(
            position < 0 for position in omitted
        ) or set(positions) & set(omitted):
            raise ValueError("Invalid public question positions")
        return self


class TurnPayload(BaseModel):
    setup: InterviewSetup = Field(default_factory=lambda: InterviewSetup(question_count=9))
    candidate_transcript: str | None = Field(default=None, min_length=1, max_length=4000)
    transcription_mode: Literal["recorded", "browser", "streaming", "typed"] = "recorded"
    recording_id: str | None
    expected_revision: int
    question: str
    model_history: list[dict[str, Any]]
    history_version: int
    earlier_dialogue: EarlierDialogue | None = None
    current_dialogue: list[PublicMessage] | None = Field(default=None, max_length=7)
    fixture_context: dict[str, Any] | None = None
    interview_context: InterviewContext | None = None

    @model_validator(mode="after")
    def require_context(self):
        if self.transcription_mode == "typed":
            if not self.candidate_transcript or not self.candidate_transcript.strip():
                raise ValueError("Reviewed text is required")
        elif not self.recording_id:
            raise ValueError("Audio turns require a recording")
        if (self.fixture_context is None) == (self.interview_context is None):
            raise ValueError("A turn requires exactly one context source")
        return self

    def personal_evidence(self) -> dict[str, Any]:
        """Return contact/provenance input without treating a fictional role as facts."""
        return self.interview_context.personal_evidence if self.interview_context else self.fixture_context

    def context_input(self) -> dict[str, Any]:
        """Preserve the versioned prepared source or the legacy fixture envelope."""
        context = ({"interview_context": self.interview_context.model_dump()} if self.interview_context
                   else {"fixture_context": self.fixture_context})
        if self.earlier_dialogue is not None:
            context["earlier_dialogue"] = self.earlier_dialogue.model_dump()
        return context


class TranscriptionPayload(BaseModel):
    recording_id: str


class SpeechPayload(BaseModel):
    text: str
    message_id: str


class PreparationPayload(BaseModel):
    frozen_context: dict[str, Any]
    setup: InterviewSetup = Field(default_factory=lambda: InterviewSetup(question_count=9))


class ExecutionConfiguration(BaseModel):
    """Rails-owned approved model and voice names, never provider endpoints."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    transcription_model: str
    interviewer_model: str
    speech_model: str
    voice: str


FAKE_CONFIGURATION = ExecutionConfiguration(
    transcription_model="fake-transcription-v1", interviewer_model="fake-interviewer-v1",
    speech_model="fake-speech-v1", voice="espeak",
)
REAL_CONFIGURATION = ExecutionConfiguration(
    transcription_model="gpt-transcribe", interviewer_model="gpt-6-luna",
    speech_model="gpt-4o-mini-tts", voice="marin",
)


class Claim(BaseModel):
    """Canonical inputs and fenced identity for one execution."""

    model_config = ConfigDict(frozen=True)
    execution_mode: Literal["fake", "real"] = "fake"
    execution_config: ExecutionConfiguration = Field(default_factory=lambda: FAKE_CONFIGURATION)
    operation_id: str
    kind: Literal["preparation", "turn", "speech", "transcription"]
    attempt_id: str
    claim_generation: StrictInt
    lease_expires_at: datetime
    execution_deadline: datetime
    payload: TurnPayload | SpeechPayload | PreparationPayload | TranscriptionPayload

    @model_validator(mode="after")
    def matching_payload(self):
        configuration = FAKE_CONFIGURATION if self.execution_mode == "fake" else REAL_CONFIGURATION
        if self.execution_config != configuration:
            raise ValueError("Invalid saved execution configuration")
        expected = {"transcription": TranscriptionPayload, "turn": TurnPayload, "speech": SpeechPayload, "preparation": PreparationPayload}[self.kind]
        if not isinstance(self.payload, expected):
            raise ValueError("Claim kind and payload differ")  # noqa: TRY004 - Pydantic validator
        return self

    def identity(self) -> dict[str, Any]:
        return {"attempt_id": self.attempt_id, "claim_generation": self.claim_generation}


class OperationStatus(BaseModel):
    operation_id: str
    status: str
    accepted_result: dict[str, Any] | None = None
    execution_count: int
    retry_at: datetime | None = None
    failure_code: str | None = None


class RailsClientError(RuntimeError):
    """Rails rejected a request; response bodies may contain private data."""

    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Rails interview request failed ({status_code})")


class RailsTransportError(RuntimeError):
    """No trustworthy receipt arrived; reconcile status before further work."""


class RailsInterviewClient:
    """Fixed-origin HTTP with finite waits and byte-identical bounded retries."""

    def __init__(self, origin: str, secret: str, *, transport=None, max_body_bytes=512_000,
                 execution_mode: Literal["fake", "real"] = "fake"):
        if execution_mode not in {"fake", "real"}:
            raise ValueError("Invalid interview execution mode")
        self._execution_mode = execution_mode
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Rails origin must be an HTTP origin")
        if not secret or any(c in secret for c in "\r\n"):
            raise ValueError("Service secret is required")
        if not 1024 <= max_body_bytes <= 1_048_576:
            raise ValueError("Invalid response size limit")
        self._origin = origin.rstrip("/")
        self._limit = max_body_bytes
        self._client = httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(10, connect=3),
            follow_redirects=False,
            trust_env=False,
            headers={"Authorization": f"Bearer {secret}", "Accept": "application/json"},
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.aclose()

    async def aclose(self):
        await self._client.aclose()

    async def transcription_capture(self, action, payload):
        """Send one bounded capture callback through the configured owner transport."""
        if action not in {"redeem", "finish", "fail"}:
            raise ValueError("Invalid capture action")
        return await self._request("POST", "transcriptions/" + action, payload,
                                   retry=action != "redeem")

    async def _request(self, method, path, payload=None, *, retry=True, allow_boolean=False):
        # A total deadline also bounds a server that trickles bytes indefinitely.
        try:
            async with asyncio.timeout(25):
                return await self._bounded_request(
                    method, path, payload, retry=retry, allow_boolean=allow_boolean
                )
        except TimeoutError:
            raise RailsTransportError("Rails request deadline exceeded") from None

    async def _bounded_request(
        self, method, path, payload=None, *, retry=True, allow_boolean=False
    ):
        body = (
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
            if payload is not None
            else None
        )
        if body and len(body) > self._limit:
            raise RailsTransportError("Rails request exceeds size limit")
        for attempt in range(2 if retry else 1):
            try:
                async with self._client.stream(
                    method,
                    self._origin + "/internal/interviews/" + path,
                    content=body,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > self._limit:
                            raise RailsTransportError("Rails response exceeds size limit")
                    if response.status_code == 503 and retry and attempt == 0:
                        continue
                    if response.status_code != 200:
                        raise RailsClientError(response.status_code)
                    result = json.loads(chunks)
                    if not isinstance(result, dict) and not (
                        allow_boolean and isinstance(result, bool)
                    ):
                        raise RailsTransportError("Invalid Rails receipt")
                    return result
            except httpx.TransportError:
                if not retry or attempt:
                    raise RailsTransportError("Rails receipt unavailable") from None
            except (ValueError, UnicodeError):
                raise RailsTransportError("Invalid Rails receipt") from None
        raise RailsTransportError("Rails receipt unavailable")

    @staticmethod
    def _path(operation_id, action=""):
        return "operations/" + quote(str(operation_id), safe="") + ("/" + action if action else "")

    async def discover(self) -> list[str]:
        # Suppress only transport polling. The supervisor creates execution tasks
        # after this scope closes, so their operation/model traces remain enabled.
        with logfire.suppress_instrumentation():
            result = await self._request("GET", "operations?execution_mode=" + self._execution_mode)
        ids = result.get("operation_ids")
        if not isinstance(ids, list) or any(not isinstance(value, str) for value in ids):
            raise RailsTransportError("Invalid operation discovery")
        return ids

    async def claim(self, operation_id) -> Claim:
        # This endpoint has no idempotency key; never replay ambiguous claim creation.
        result = await self._request("POST", self._path(operation_id, "claim"),
                                     {"execution_mode": self._execution_mode}, retry=False)
        try:
            claim = Claim.model_validate(result)
            if claim.operation_id != str(operation_id) or claim.execution_mode != self._execution_mode:
                raise ValueError("Wrong operation")
            return claim
        except (ValidationError, ValueError):
            raise RailsTransportError("Invalid claim receipt") from None

    async def status(self, operation_id) -> OperationStatus:
        result = await self._request("GET", self._path(operation_id))
        try:
            status = OperationStatus.model_validate(result)
            if status.operation_id != str(operation_id):
                raise ValueError("Wrong operation")
            return status
        except (ValidationError, ValueError):
            raise RailsTransportError("Invalid status receipt") from None

    async def _callback(self, claim, action, **values):
        return await self._request(
            "POST",
            self._path(claim.operation_id, action),
            {**claim.identity(), **values},
            allow_boolean=action == "usage",
        )

    async def heartbeat(self, claim: Claim, checkpoint: str | None = None):
        return await self._callback(claim, "heartbeat", checkpoint=checkpoint)

    async def screen_library(self, claim: Claim, source_indices: list[int], *, career_focus_sha256: str | None = None):
        """Require durable receipts for checked source indices and optional exact focus.

        Omit the focus argument for the unchanged legacy request/response contract.
        """
        values = {"source_indices": source_indices}
        if career_focus_sha256 is not None:
            values["career_focus_sha256"] = career_focus_sha256
        result = await self._callback(claim, "screen_library", **values)
        indices = result.get("screened_source_indices")
        if (not isinstance(indices, list) or any(type(index) is not int or index < 0 for index in indices)
                or not set(source_indices).issubset(indices)):
            raise RailsTransportError("Invalid library screening receipt")
        if career_focus_sha256 is not None and result.get("screened_career_focus_sha256") != career_focus_sha256:
            raise RailsTransportError("Invalid career focus screening receipt")
        return result

    async def recording(self, claim: Claim):
        return await self._callback(claim, "recording")

    async def reserve_audio(self, claim: Claim, content_type: str):
        return await self._callback(claim, "reserve_audio", content_type=content_type)

    async def register_audio(self, claim: Claim, media_id: str, checksum: str, byte_size: int):
        return await self._callback(
            claim, "register_audio", media_id=media_id, checksum=checksum, byte_size=byte_size
        )

    async def complete_audio(self, claim: Claim, media_id: str):
        return await self._callback(claim, "complete_audio", media_id=media_id)

    async def accept_transcription(self, claim, transcript):
        return await self._callback(claim, "accept_transcription", transcript=transcript)

    async def accept(
        self,
        claim: Claim,
        *,
        transcript: str,
        decision: str,
        reply: str | None,
        history_version: int,
        model_history: list[dict[str, Any]],
        acknowledgement: str | None = None,
    ):
        return await self._callback(
            claim,
            "accept",
            transcript=transcript,
            decision=decision,
            reply=reply,
            history_version=history_version,
            model_history=model_history,
            **({"acknowledgement": acknowledgement} if acknowledgement is not None else {}),
        )

    async def fail(self, claim: Claim, code: str, retryable: bool):
        return await self._callback(claim, "fail", code=code, retryable=retryable)

    async def accept_preparation(self, claim: Claim, *, role: dict, questions: list[dict]):
        return await self._callback(claim, "accept_preparation", role=role, questions=questions)

    async def start_provider(
        self, claim: Claim, observation_id: str, stage: str, provider: str, model: str
    ):
        result = await self._callback(
            claim,
            "start_provider",
            observation_id=observation_id,
            stage=stage,
            provider=provider,
            model=model,
        )
        if result.get("observation_id") != observation_id:
            raise RailsTransportError("Invalid provider admission receipt")
        return result

    async def usage(
        self,
        claim: Claim,
        usage: list[dict[str, Any]],
        *,
        incomplete=False,
        observation_id: str | None = None,
    ):
        return await self._callback(
            claim, "usage", usage=usage, incomplete=incomplete, observation_id=observation_id
        )

    async def cleanup(self):
        return await self._request("POST", "cleanup", {})
