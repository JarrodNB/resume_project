"""Validate canonical chat claims over the shared bounded Rails callback transport.

The browser never supplies history, contact data, or attempt identity to this client.
Rails grants IDs and checkpoints; Python loads the accepted records itself.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, model_validator

from interviews.client import RailsInterviewClient, RailsTransportError


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=80000)
    position: int = Field(ge=1)


class ChatContact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    names: list[str] = Field(default_factory=list, max_length=20)
    emails: list[str] = Field(default_factory=list, max_length=20)
    phones: list[str] = Field(default_factory=list, max_length=20)


class ChatSummary(BaseModel):
    """Rails-owned rolling memory and its complete-exchange checkpoint."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    text: str = Field(default="", max_length=8000)
    version: StrictInt = Field(default=0, ge=0)
    through_position: StrictInt = Field(default=0, ge=0)

    @model_validator(mode="after")
    def complete_checkpoint(self):
        if self.through_position % 2 or ((self.through_position == 0) != (self.version == 0)):
            raise ValueError("Invalid summary checkpoint")
        if bool(self.text.strip()) != bool(self.through_position):
            raise ValueError("Summary text must match its checkpoint")
        return self


class ChatSummaryPlan(BaseModel):
    """Only the owner chooses which complete prefix may be compacted."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    through_position: StrictInt = Field(ge=2)
    scheduled: bool


class ChatPayload(BaseModel):
    """Process-local hydrated context; never accepted from the Rails claim transport."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    conversation_id: str
    user_id: str
    message: str = Field(min_length=1, max_length=80000)
    max_input_characters: int = Field(ge=1, le=80000)
    summarize_every_user_messages: int = Field(ge=1)
    messages: list[ChatMessage] = Field(default_factory=list, max_length=1000)
    summary: ChatSummary = Field(default_factory=ChatSummary)
    summary_plan: ChatSummaryPlan | None = None
    contact: ChatContact = Field(default_factory=ChatContact)

    @model_validator(mode="after")
    def accepted_dialogue(self):
        positions = [m.position for m in self.messages]
        if positions != list(range(self.summary.through_position + 1, self.summary.through_position + len(positions) + 1)) or any(
            m.role != ("user" if i % 2 == 0 else "assistant") for i, m in enumerate(self.messages)
        ) or len(positions) % 2:
            raise ValueError("History must contain complete accepted exchanges")
        if len(self.message) > self.max_input_characters or not self.message.strip():
            raise ValueError("Message exceeds its authoritative limit")
        last = positions[-1] if positions else self.summary.through_position
        if self.summary_plan:
            plan = self.summary_plan
            target = (last // 2 + 1 - 5) * 2 if plan.scheduled else last - 10
            if plan.through_position != target or not self.summary.through_position < target <= last:
                raise ValueError("Summary plan must cover an exact old prefix and retain recent exchanges")
            if plan.scheduled and (last // 2 + 1) % self.summarize_every_user_messages:
                raise ValueError("Scheduled summary is off cadence")
        if sum(len(m.content) for m in self.messages) + len(self.message) + len(self.summary.text) > 200_000:
            raise ValueError("Chat source exceeds its bounded size")
        return self


class ChatReferencePayload(BaseModel):
    """A bounded owned command; saved source text never crosses the claim transport."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: Literal[1]
    conversation_id: str
    user_id: str
    expected_position: StrictInt = Field(ge=0)
    summary_base_version: StrictInt = Field(ge=0)
    summary_through_position: StrictInt = Field(ge=0)
    summary_plan: ChatSummaryPlan | None = None
    max_input_characters: StrictInt = Field(ge=1, le=80000)
    summarize_every_user_messages: StrictInt = Field(ge=1)


class ChatClaim(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    operation_id: str
    attempt_id: str
    claim_generation: StrictInt = Field(ge=1)
    lease_expires_at: datetime
    execution_deadline: datetime
    payload: ChatReferencePayload | ChatPayload

    def identity(self):
        return {"attempt_id": self.attempt_id, "claim_generation": self.claim_generation}


class RailsChatClient(RailsInterviewClient):
    """Share bounded callbacks, while keeping chat's domain contract separate."""

    def __init__(self, origin, secret, **kwargs):
        kwargs.setdefault("max_body_bytes", 1_048_576)
        super().__init__(origin, secret, namespace="chat", **kwargs)

    async def claim(self, operation_id):
        result = await self._request("POST", self._path(operation_id, "claim"), {}, retry=False)
        try:
            ChatReferencePayload.model_validate(result.get("payload"))
            claim = ChatClaim.model_validate(result)
            if claim.operation_id != str(operation_id):
                raise ValueError("Wrong operation")
            return claim
        except (ValueError, ValidationError):
            raise RailsTransportError("Invalid chat claim receipt") from None

    async def status(self, operation_id):
        result = await self._request("GET", self._path(operation_id))
        if result.get("operation_id") != str(operation_id):
            raise RailsTransportError("Invalid chat status receipt")
        return result

    async def accept(self, claim, *, reply, screened_message_sha256, summary_update=None, record_screening=None, career_context=None):
        values = {"reply": reply, "screened_message_sha256": screened_message_sha256}
        if summary_update is not None:
            values["summary_update"] = summary_update
        if career_context is not None:
            values["career_context"] = career_context
        if record_screening is not None:
            values["record_screening"] = record_screening
        return await self._callback(claim, "accept", **values)
