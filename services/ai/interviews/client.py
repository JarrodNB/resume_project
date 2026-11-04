"""Send bounded execution callbacks to the Rails owner of interview state.

Only the configured Rails origin receives the service credential. Storage grants
are data for the separate credential-free media client, never navigation targets.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, model_validator

from execution.rails_client import (
    RailsClientError as RailsClientError,  # noqa: PLC0414 - preserve existing imports
)
from execution.rails_client import RailsExecutionClient
from execution.rails_client import (
    RailsTransportError as RailsTransportError,  # noqa: PLC0414 - preserve existing imports
)
from schemas.interview_setup import InterviewSetup


class InterviewContext(BaseModel):
    """Keep privacy-only contact hints separate from the generated fictional role."""

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
    """Complete canonical question groups selected under a content-character cap."""

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


class TranscriptionPayload(BaseModel):
    recording_id: str


class SpeechPayload(BaseModel):
    text: str
    message_id: str


class PreparationPayload(BaseModel):
    preparation_context: dict[str, Any]
    setup: InterviewSetup = Field(default_factory=lambda: InterviewSetup(question_count=9))


class ReferencePayload(BaseModel):
    """Versioned execution identity; saved text is loaded through owned DB reads."""

    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    interview_id: str
    user_id: str
    setup: InterviewSetup


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
    """Fenced execution identity; source inputs are expanded only inside Python."""

    model_config = ConfigDict(frozen=True)
    execution_mode: Literal["fake", "real"] = "fake"
    execution_config: ExecutionConfiguration = Field(default_factory=lambda: FAKE_CONFIGURATION)
    operation_id: str
    kind: Literal["preparation", "turn", "speech", "transcription"]
    attempt_id: str
    claim_generation: StrictInt
    lease_expires_at: datetime
    execution_deadline: datetime
    payload: ReferencePayload | TurnPayload | SpeechPayload | PreparationPayload | TranscriptionPayload

    @model_validator(mode="after")
    def matching_payload(self):
        configuration = FAKE_CONFIGURATION if self.execution_mode == "fake" else REAL_CONFIGURATION
        if self.execution_config != configuration:
            raise ValueError("Invalid saved execution configuration")
        expected = {"transcription": TranscriptionPayload, "turn": TurnPayload, "speech": SpeechPayload, "preparation": PreparationPayload}[self.kind]
        if not isinstance(self.payload, (expected, ReferencePayload)):
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


class RailsInterviewClient(RailsExecutionClient):
    """Fixed-origin HTTP with finite waits and byte-identical bounded retries."""


    def __init__(self, origin: str, secret: str, *, transport=None, max_body_bytes=512_000,
                 execution_mode: Literal["fake", "real"] = "fake", namespace="interviews"):
        if execution_mode not in {"fake", "real"}:
            raise ValueError("Invalid interview execution mode")
        self._execution_mode = execution_mode
        super().__init__(origin, secret, transport=transport, max_body_bytes=max_body_bytes,
                         namespace=namespace)

    async def transcription_capture(self, action, payload):
        """Send one bounded capture callback through the configured owner transport."""
        if action not in {"redeem", "finish", "fail"}:
            raise ValueError("Invalid capture action")
        return await self._request("POST", "transcriptions/" + action, payload,
                                   retry=action != "redeem")


    async def claim(self, operation_id) -> Claim:
        # This endpoint has no idempotency key; never replay ambiguous claim creation.
        result = await self._request("POST", self._path(operation_id, "claim"),
                                     {"execution_mode": self._execution_mode}, retry=False)
        try:
            ReferencePayload.model_validate(result.get("payload"))
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
        acknowledgement: str | None = None,
    ):
        return await self._callback(
            claim,
            "accept",
            transcript=transcript,
            decision=decision,
            reply=reply,
            **({"acknowledgement": acknowledgement} if acknowledgement is not None else {}),
        )


    async def accept_preparation(self, claim: Claim, *, role: dict | None, questions: list[dict]):
        return await self._callback(claim, "accept_preparation", role=role, questions=questions)
