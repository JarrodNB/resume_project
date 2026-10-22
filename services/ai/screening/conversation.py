"""Screen the newest message in an authenticated saved conversation.

Callers reconstruct prior dialogue from their domain owner's accepted records. This
interface never walks historical user/tool messages; generic prompt screening is unchanged.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic_ai_harness import InputBlocked

from worker.contact_mask import mask_outbound


@dataclass(frozen=True)
class ScreenedConversationTurn:
    """Exact new-message coverage for one guarded generative run, not arbitrary history."""

    prompt: str

    async def guard(self, ctx, prompt: str) -> bool:
        if mask_outbound(prompt) != self.prompt:
            raise InputBlocked('The conversation input changed after screening.')
        return True


async def screen_conversation_turn(
    newest_message: str, *, screen: Callable[[str], Awaitable[None]],
    render: Callable[[str], str],
) -> ScreenedConversationTurn:
    """Check only new text, then render its exact prompt using trusted scaffolding.

    The renderer may add application-owned labels, never hidden untrusted input.
    A failed/unchecked screen must raise; no coverage is returned on failure.
    """
    newest_message = mask_outbound(newest_message)
    await screen(newest_message)
    return ScreenedConversationTurn(mask_outbound(render(newest_message)))
