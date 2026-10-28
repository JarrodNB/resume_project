"""Validate canonical chat claims over the shared bounded Rails callback transport.

The browser never supplies history, contact data, or attempt identity to this client.
Only the fixed Rails owner can provide the accepted records used as model context.
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


class ChatPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    conversation_id: str
    user_id: str
    message: str = Field(min_length=1, max_length=80000)
    max_input_characters: int = Field(ge=1, le=80000)
    summarize_every_user_messages: int = Field(ge=1)
    messages: list[ChatMessage] = Field(default_factory=list)
    contact: ChatContact = Field(default_factory=ChatContact)

    @model_validator(mode="after")
    def accepted_dialogue(self):
        positions = [m.position for m in self.messages]
        if positions != list(range(1, len(positions) + 1)) or any(
            m.role != ("user" if i % 2 == 0 else "assistant") for i, m in enumerate(self.messages)
        ) or len(positions) % 2:
            raise ValueError("History must contain complete accepted exchanges")
        if len(self.message) > self.max_input_characters or not self.message.strip():
            raise ValueError("Message exceeds its authoritative limit")
        return self


class ChatClaim(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    operation_id: str
    attempt_id: str
    claim_generation: StrictInt = Field(ge=1)
    lease_expires_at: datetime
    execution_deadline: datetime
    payload: ChatPayload

    def identity(self):
        return {"attempt_id": self.attempt_id, "claim_generation": self.claim_generation}


class RailsChatClient(RailsInterviewClient):
    """Share bounded callbacks, while keeping chat's domain contract separate."""

    def __init__(self, origin, secret, **kwargs):
        super().__init__(origin, secret, namespace="chat", **kwargs)

    async def claim(self, operation_id):
        result = await self._request("POST", self._path(operation_id, "claim"), {}, retry=False)
        try:
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

    async def accept(self, claim, *, reply, screened_message_sha256):
        return await self._callback(claim, "accept", reply=reply,
                                    screened_message_sha256=screened_message_sha256)
