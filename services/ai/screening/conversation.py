"""Screen the newest message in an authenticated saved conversation (chat and spoken interviews).

Callers reconstruct prior dialogue from their domain owner's accepted records. This
interface never walks historical user/tool messages; generic prompt screening is unchanged.
Conversation runtimes screen on fixed Jev with a Nano fallback, billed to their own
operation through `accounted` models rather than the queued worker's settings.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic_ai.models import Model
from pydantic_ai_harness import InputBlocked

from agents.user_text_fallback_agent import screen_fallback_message_async, user_text_fallback_agent
from agents.user_text_screen_agent import screen_user_message_async, user_text_screen_agent
from privacy.contact_mask import mask_outbound
from screening.screen_user_text import ScreenOutcome, screen_user_text_async
from settings import JEV_SCREEN_MODEL

CONVERSATION_SCREEN_FALLBACK_MODEL = "openai:gpt-5-nano"


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


async def screen_with_operation_models(
    text: str, timeout_seconds: float, accounted: Callable[[str], Model],
) -> ScreenOutcome:
    """Apply the shared screening policy on models that bill this operation.

    `accounted` receives a bare model name (`jev-1.13.0` or `gpt-5-nano`) and returns a
    model that records usage for the caller's claim. Returns the decision; callers raise.
    """
    async def primary(chunk, model, timeout):
        with user_text_screen_agent.override(model=accounted(_bare_model_name(model))):
            return await screen_user_message_async(chunk, model, timeout)

    async def fallback(chunk, model, timeout):
        # Shared policy chooses fallback only after an attempted Jev failure.
        if model != CONVERSATION_SCREEN_FALLBACK_MODEL:
            raise ValueError("Unsupported conversation screening fallback")
        with user_text_fallback_agent.override(model=accounted(_bare_model_name(model))):
            return await screen_fallback_message_async(chunk, model, timeout)

    return await screen_user_text_async(
        text, JEV_SCREEN_MODEL, timeout_seconds, classify=primary, classify_fallback=fallback,
        _fallback_model=CONVERSATION_SCREEN_FALLBACK_MODEL,
    )


def _bare_model_name(model: str) -> str:
    return model.removeprefix("openai:").removeprefix("typesafe:")
