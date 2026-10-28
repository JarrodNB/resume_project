"""
Description: Enforces input coverage before every generative agent's first provider request.
Exact prompts built from screened sources reuse their decisions; unknown user/tool inputs
receive chunked Jev checks. A block raises rather than returning prose to a structured caller.
Index:
    - screen_prompt: checks assembled input and supplied history before generation
"""

import json
from typing import Any

from pydantic_ai import RunContext
from pydantic_ai.messages import ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai_harness import InputBlocked

from privacy.contact_mask import covered_prompt_length
from screening.screen_user_text import screen_user_text_async
from screening.session import prompt_is_covered, screening_session
from settings import load_settings
from text_limits import MAX_PROMPT_TEXT

BLOCKED_MESSAGE = "This content could not pass the input safety check. Revise it and try again."
UNCHECKED_MESSAGE = "Input safety screening is unavailable. Please try again later."
TOO_LONG_MESSAGE = "This content is too long to screen. Shorten it and try again."


async def screen_prompt(ctx: RunContext[Any], prompt: str) -> bool:
    """Check unknown input and history while reusing exact approved prompt coverage.

    InputGuardrail runs once before the first request, including direct agent/eval calls.
    Subsequent output-validation retries reuse this checked input. No production bypass
    depends on a test model or tracing being enabled.
    """
    inputs = _input_parts(ctx, prompt)
    # Only an exact screened import prompt may discount opaque token expansion.
    # Unknown history and every other task retain their actual character counts.
    length = sum(covered_prompt_length(text) if prompt_is_covered(text) else len(text)
                 for text in inputs) + max(0, len(inputs) - 1) * 2
    if length > MAX_PROMPT_TEXT:
        raise InputBlocked(TOO_LONG_MESSAGE)
    settings = load_settings()
    async def classify(text: str, model: str, timeout: float) -> Any:
        """Run the primary provider seam; shared screening owns recovery and usage."""
        run = await _screen_prompt_text(
            text, model, timeout,
        )
        return run

    with screening_session(settings.llm_run_timeout_seconds, reuse=True):
        for text in inputs:
            if prompt_is_covered(text):
                continue
            outcome = await screen_user_text_async(
                text, settings.user_text_screen_model, settings.llm_run_timeout_seconds,
                max_characters=MAX_PROMPT_TEXT, classify=classify,
            )
            if not outcome.allowed:
                raise InputBlocked(
                    TOO_LONG_MESSAGE if outcome.too_long else UNCHECKED_MESSAGE if outcome.unchecked else BLOCKED_MESSAGE
                )
    return True


async def _screen_prompt_text(text: str, model: str, timeout_seconds: float) -> Any:
    """Runs Jev asynchronously without applying this guard to the screening agent itself."""
    from agents.user_text_screen_agent import screen_user_message_async

    return await screen_user_message_async(text, model, timeout_seconds)


def _input_parts(ctx: RunContext[Any], prompt: str) -> list[str]:
    """Includes prior user/tool input so a supplied history cannot bypass the guard.

    System instructions are application-owned. Current agents accept text only; unknown
    user content is rejected rather than silently dropping attachments from screening.
    """
    texts: list[str] = []
    prompt_index: int | None = None
    for message in ctx.messages:
        if not isinstance(message, ModelRequest):
            continue
        for part in message.parts:
            if isinstance(part, UserPromptPart):
                if not isinstance(part.content, str):
                    raise InputBlocked("Only text input is supported by this safety check.")
                prompt_index = len(texts)
                texts.append(part.content)
            elif isinstance(part, ToolReturnPart):
                texts.append(json.dumps(part.content, ensure_ascii=False, default=str))
    if prompt_index is None:
        texts.append(prompt)
    else:
        # InputGuardrail supplies the final prompt after message-transforming hooks.
        # Replace its original version rather than screening both masked and raw copies.
        texts[prompt_index] = prompt
    return texts
