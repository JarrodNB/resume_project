"""Call Rails for the live interview agent over the private internal HTTP boundary.

Uses the same fixed-origin, bearer-authenticated and size-bounded transport as the other
interview callbacks. Requests carry only IDs, positions and the interviewer's spoken text;
Rails decides whether each one still applies. Every call is idempotent on the Rails side, so
an ambiguous network failure retries the identical request once.
"""

from urllib.parse import quote

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
        """Save what the interviewer asked; returns Rails' `{message_id, question_position, revision}`."""
        return await self._request("POST", self._live_path(connection_id, "prompt_asked"),
                                   {"question_position": question_position, "kind": kind, "text": text})
