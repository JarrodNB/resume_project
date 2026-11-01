"""Stage one user-requested career context for Rails to save with the chat reply.

The tool only checks owned saved records. Its proposal lives in this reply run and
has no durable effect until Rails accepts the attempt, dialogue and proposal together.
"""
import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field

from psycopg import Error as DatabaseError


@dataclass
class CareerContextProposal:
    user_id: str
    check: Callable[[str, str, str], str]
    restore: Callable[[str], str]
    value: dict[str, str] | None = None
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def save_career_context(self, requirement: str, response: str) -> str:
        """Save one career fact only when the user explicitly asks or agrees to save it.

        requirement is a short topic, not evidence; response contains the user's actual
        contribution and context. Never save hypothetical advice or invented details.
        This stages a save committed atomically with the final accepted reply.
        """
        async with self._lock:
            proposed = {"requirement": self.restore(requirement).strip(), "response": self.restore(response).strip()}
            if not proposed["requirement"] or not proposed["response"] or len(proposed["requirement"]) > 1000 or len(proposed["response"]) > 4000:
                return "Not saved: use a nonblank topic up to 1,000 characters and response up to 4,000 characters."
            if self.value is not None:
                return "Save pending with this reply." if self.value == proposed else "Not saved: only one distinct career context can be saved per turn."
            try:
                status = await asyncio.to_thread(self.check, self.user_id, proposed["requirement"], proposed["response"])
            except DatabaseError:
                return "Not saved: career context is unavailable. Please try again later."
            if status == "ready":
                self.value = proposed
                return "Save pending: this career context will be saved when this reply is accepted."
            if status == "already_saved":
                # Still submit it so acceptance rechecks that the record remains unchanged.
                self.value = proposed
                return "This exact career context is already saved; it will be checked again with this reply."
            if status == "conflict":
                return "Not saved: that topic already has a different response. Ask for a distinct topic; existing context cannot be overwritten here."
            if status == "full":
                return "Not saved: Career context already has 100 entries. Remove an entry before saving another."
            return "Not saved: career context is unavailable. Please try again later."
