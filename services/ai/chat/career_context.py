"""Stage one user-requested career context for Rails to save with the chat reply.

The tool only checks owned saved records. Its proposal lives in this reply run and
has no durable effect until Rails accepts the attempt, dialogue and proposal together.
Its span records only the tool version and outcome, never the saved text.
"""
import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field

import logfire
from psycopg import Error as DatabaseError

from text_limits import MAX_BULLET_TEXT, MAX_CAREER_CONTEXTS, MAX_PROSE_TEXT

# Bump when the tool's description, arguments or outcome sentences change.
SAVE_CAREER_CONTEXT_VERSION = "save-career-context-v1"

INVALID_MESSAGE = (f"Not saved: use a nonblank topic up to {MAX_BULLET_TEXT:,} characters "
                   f"and response up to {MAX_PROSE_TEXT:,} characters.")
UNAVAILABLE_MESSAGE = "Not saved: career context is unavailable. Please try again later."
OUTCOME_MESSAGES = {
    "pending": "Save pending: this career context will be saved when this reply is accepted.",
    "repeated": "Save pending with this reply.",
    "second_save": "Not saved: only one distinct career context can be saved per turn.",
    "already_saved": ("This exact career context is already saved; "
                      "it will be checked again with this reply."),
    "conflict": ("Not saved: that topic already has a different response. "
                 "Ask for a distinct topic; existing context cannot be overwritten here."),
    "full": (f"Not saved: Career context already has {MAX_CAREER_CONTEXTS} entries. "
             "Remove an entry before saving another."),
    "invalid": INVALID_MESSAGE,
    "unavailable": UNAVAILABLE_MESSAGE,
}


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
        with logfire.span("chat.save_career_context",
                          tool_version=SAVE_CAREER_CONTEXT_VERSION) as span:
            outcome = await self._stage(requirement, response)
            span.set_attribute("outcome", outcome)
        return OUTCOME_MESSAGES[outcome]

    async def _stage(self, requirement: str, response: str) -> str:
        async with self._lock:
            proposed = {"requirement": self.restore(requirement).strip(),
                        "response": self.restore(response).strip()}
            if (not proposed["requirement"] or not proposed["response"]
                    or len(proposed["requirement"]) > MAX_BULLET_TEXT
                    or len(proposed["response"]) > MAX_PROSE_TEXT):
                return "invalid"
            if self.value is not None:
                return "repeated" if self.value == proposed else "second_save"
            try:
                status = await asyncio.to_thread(self.check, self.user_id,
                                                 proposed["requirement"], proposed["response"])
            except DatabaseError:
                return "unavailable"
            if status == "ready":
                self.value = proposed
                return "pending"
            if status == "already_saved":
                # Still submit it so acceptance rechecks that the record remains unchanged.
                self.value = proposed
                return "already_saved"
            return status if status in ("conflict", "full") else "unavailable"
