"""Call Rails for the live interview agent over the private internal HTTP boundary.

Uses the same fixed-origin, bearer-authenticated and size-bounded transport as the other
interview callbacks. Requests carry only IDs, positions, the interviewer's spoken follow-ups
and the candidate's answers; Rails decides whether each one still applies. Every call is
idempotent on the Rails side (a follow-up through its fresh `prompt_key`), so an ambiguous
network failure retries the identical request once.
"""

from urllib.parse import quote
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from execution.rails_client import (
    RailsClientError as RailsClientError,  # noqa: PLC0414 - one import point for callers
)
from execution.rails_client import RailsExecutionClient
from execution.rails_client import (
    RailsTransportError as RailsTransportError,  # noqa: PLC0414 - one import point for callers
)


class LiveConnectionClaim(BaseModel):
    """Rails' answer to a claim: the identities to read with and where the interview stands."""

    model_config = ConfigDict(frozen=True, extra="ignore")
    interview_session_id: str
    live_connection_id: str
    user_id: str
    question_total: int = Field(ge=1)
    current_question_position: int = Field(ge=0)
    answer_cap: int = Field(ge=1, le=3)


class RailsLiveInterviewClient(RailsExecutionClient):
    """The live agent's Rails callbacks, all under /internal/interviews/live_connections/."""

    def __init__(self, origin: str, secret: str, *, transport=None):
        super().__init__(origin, secret, transport=transport, max_body_bytes=64_000, namespace="interviews")

    @staticmethod
    def _live_path(connection_id, action):
        return "live_connections/" + quote(str(connection_id), safe="") + "/" + action

    async def claim(self, connection_id: str, *, room_name: str) -> LiveConnectionClaim:
        """Mark this dispatch's connection connected; refusals raise RailsClientError."""
        result = await self._request("POST", self._live_path(connection_id, "claim"), {"room_name": room_name})
        try:
            claim = LiveConnectionClaim.model_validate(result)
        except ValidationError:
            raise RailsTransportError("Invalid live claim receipt") from None
        if claim.live_connection_id != str(connection_id) or claim.current_question_position >= claim.question_total:
            raise RailsTransportError("Invalid live claim receipt")
        return claim

    async def prompt_asked(self, connection_id: str, *, question_position: int, kind: str, text: str) -> dict:
        """Save what the interviewer asked; returns Rails' `{message_id, question_position, revision}`.

        Rails keeps the prepared text for an opening. Each follow-up gets a new `prompt_key`, so
        only this call's own retry can return an already saved follow-up.
        """
        body = {"question_position": question_position, "kind": kind, "text": text}
        if kind == "follow_up":
            body["prompt_key"] = uuid4().hex
        return await self._request("POST", self._live_path(connection_id, "prompt_asked"), body)

    async def answer_finished(self, connection_id: str, *, prompt_message_id: str, transcript: str) -> dict:
        """Save or replace the candidate's answer to one saved prompt."""
        return await self._request("POST", self._live_path(connection_id, "answer_finished"),
                                   {"prompt_message_id": prompt_message_id, "transcript": transcript})

    async def question_advanced(self, connection_id: str, *, question_position: int) -> dict:
        """Move past the current question; returns `{current_question_position, revision}`."""
        return await self._request("POST", self._live_path(connection_id, "question_advanced"),
                                   {"question_position": question_position})

    async def finish(self, connection_id: str, *, reason: str) -> dict:
        """End the connection and complete or abandon the interview; returns `{status, end_reason, revision}`."""
        return await self._request("POST", self._live_path(connection_id, "finish"), {"reason": reason})
