"""Call Rails for the live interview agent over the private internal HTTP boundary.

Uses the same fixed-origin, bearer-authenticated and size-bounded transport as the other
interview callbacks. Requests carry only IDs, positions and retry numbers, the interviewer's
spoken follow-ups and feedback, the candidate's answers, and heartbeat counts (billed seconds
and priced token/audio usage, never text); Rails decides whether each one still applies. Every
call is idempotent on the Rails side (a follow-up through its `prompt_key`, a retry
through its number, a heartbeat through its sequence), so an ambiguous network failure retries
the identical request once. A refusal with the code `connection_ended` raises
LiveConnectionEnded, so the agent can tell "this interview is over, leave" from a stale report.
"""

from typing import Literal
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from execution.rails_client import (
    RailsClientError as RailsClientError,  # noqa: PLC0414 - one import point for callers
)
from execution.rails_client import RailsExecutionClient
from execution.rails_client import (
    RailsTransportError as RailsTransportError,  # noqa: PLC0414 - one import point for callers
)


class LiveConnectionEnded(RailsClientError):
    """Rails refused a live call because the connection or its interview is over (code
    `connection_ended`): recovery or the owner ended it, or the session finished. The agent leaves."""


class LiveConnectionClaim(BaseModel):
    """Rails' answer to a claim: the identities to read with and where the interview stands.

    The `current_*` and `heartbeat_sequence` fields let a fresh agent that takes over a running
    connection carry on from the same place (only IDs, flags and counts, never text)."""

    model_config = ConfigDict(frozen=True, extra="ignore")
    interview_session_id: str
    live_connection_id: str
    user_id: str
    question_total: int = Field(ge=1)
    current_question_position: int = Field(ge=0)
    answer_cap: int = Field(ge=1, le=3)
    current_question_retry_count: int = Field(default=0, ge=0, le=2)
    session_seconds_left: int = Field(ge=0)  # counted seconds left on the session's 25-minute clock
    allowance_seconds_left: int = Field(ge=0)
    heartbeat_sequence: int = Field(default=0, ge=0)  # the last heartbeat Rails applied
    current_prompt_message_id: str | None = None  # the current question's latest saved prompt
    current_prompt_kind: Literal["opening", "follow_up"] | None = None
    current_prompt_answered: bool = False
    current_question_answer_count: int = Field(default=0, ge=0, le=3)
    current_question_feedback_given: bool = False


class HeartbeatReply(BaseModel):
    """Rails' answer to a heartbeat: carry on, warn the candidate, or wrap up now and why."""

    model_config = ConfigDict(frozen=True, extra="ignore")
    action: Literal["continue", "warn", "wrap_up"]
    reason: Literal["allowance", "time_limit"] | None = None
    allowance_seconds_left: int = Field(ge=0)
    session_seconds_left: int = Field(ge=0)


class RailsLiveInterviewClient(RailsExecutionClient):
    """The live agent's Rails callbacks, all under /internal/interviews/live_connections/."""

    def __init__(self, origin: str, secret: str, *, transport=None):
        super().__init__(origin, secret, transport=transport, max_body_bytes=64_000, namespace="interviews")

    async def _request(self, *args, **kwargs):
        try:
            return await super()._request(*args, **kwargs)
        except RailsClientError as error:
            if error.status_code == 409 and error.code == "connection_ended":
                raise LiveConnectionEnded(error.status_code, error.code) from None
            raise

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

    async def prompt_asked(self, connection_id: str, *, question_position: int, kind: str, text: str,
                           prompt_key: str | None = None) -> dict:
        """Save what the interviewer asked; returns Rails' `{message_id, question_position, revision}`.

        Rails keeps the prepared text for an opening. A follow-up carries the controller's
        `prompt_key` (named by question, retry and answers so far), so a repeat of the same
        follow-up, even from an agent that took over after a crash, returns the saved one.
        """
        body = {"question_position": question_position, "kind": kind, "text": text}
        if prompt_key is not None:
            body["prompt_key"] = prompt_key
        return await self._request("POST", self._live_path(connection_id, "prompt_asked"), body)

    async def answer_finished(self, connection_id: str, *, prompt_message_id: str, transcript: str) -> dict:
        """Save or replace the candidate's answer to one saved prompt."""
        return await self._request("POST", self._live_path(connection_id, "answer_finished"),
                                   {"prompt_message_id": prompt_message_id, "transcript": transcript})

    async def question_advanced(self, connection_id: str, *, question_position: int) -> dict:
        """Move past the current question; returns `{current_question_position, revision}`."""
        return await self._request("POST", self._live_path(connection_id, "question_advanced"),
                                   {"question_position": question_position})

    async def feedback_given(self, connection_id: str, *, question_position: int, text: str) -> dict:
        """Save or replace the spoken feedback for the current question; returns `{question_position, revision}`."""
        return await self._request("POST", self._live_path(connection_id, "feedback_given"),
                                   {"question_position": question_position, "text": text})

    async def question_retried(self, connection_id: str, *, question_position: int, retry_number: int) -> dict:
        """Restart the current question (retry 1 or 2); returns `{question_position, retry_count, revision}`."""
        return await self._request("POST", self._live_path(connection_id, "question_retried"),
                                   {"question_position": question_position, "retry_number": retry_number})

    async def heartbeat(self, connection_id: str, *, sequence: int, billed_seconds_delta: int,
                        usage: list[dict]) -> HeartbeatReply:
        """Report counted seconds and priced usage since the last heartbeat; a repeated sequence replays."""
        result = await self._request("POST", self._live_path(connection_id, "heartbeat"),
                                     {"sequence": sequence, "billed_seconds_delta": billed_seconds_delta, "usage": usage})
        try:
            return HeartbeatReply.model_validate(result)
        except ValidationError:
            raise RailsTransportError("Invalid live heartbeat receipt") from None

    async def finish(self, connection_id: str, *, reason: str, final_sequence: int | None = None) -> dict:
        """End the connection and complete or abandon the interview; returns `{status, end_reason, revision}`.

        `final_sequence` names the heartbeat sent just before, so Rails can close the bill as known.
        """
        body = {"reason": reason} if final_sequence is None else {"reason": reason, "final_sequence": final_sequence}
        return await self._request("POST", self._live_path(connection_id, "finish"), body)
