"""
Description: Sequential InputGuardrail policy for every generative agent's complete prompt.
Screening uses Jev without a recursive guardrail; a block raises rather than returning prose
to a caller expecting structured output. Existing field checks provide earlier user feedback.
Index:
    - screen_prompt: checks assembled input and supplied history before generation
"""

import json
import logging
import os
from typing import Any

from pydantic_ai import RunContext
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai_harness import InputBlocked

from screening.guardrail_usage import record_guardrail_usage
from screening.yes_confidence import blocks_on_yes_confidence
from text_limits import MAX_PROMPT_TEXT
from worker.settings import load_settings

logger = logging.getLogger(__name__)

BLOCKED_MESSAGE = "This content could not pass the input safety check. Revise it and try again."
UNCHECKED_MESSAGE = "Input safety screening is unavailable. Please try again later."
TOO_LONG_MESSAGE = "This content is too long to screen. Shorten it and try again."


async def screen_prompt(ctx: RunContext[Any], prompt: str) -> bool:
    """Screens the complete assembled prompt, including stored/retrieved data and history.

    InputGuardrail runs once before the first request, including direct agent/eval calls.
    Subsequent output-validation retries reuse this checked input. No production bypass
    depends on a test model or tracing being enabled.
    """
    text = _input_text(ctx, prompt)
    if not text.strip():
        return True
    if len(text) > MAX_PROMPT_TEXT:
        raise InputBlocked(TOO_LONG_MESSAGE)
    if not os.environ.get("TYPESAFE_API_KEY", "").strip():
        raise InputBlocked(UNCHECKED_MESSAGE)
    settings = load_settings()
    try:
        run = await _screen_prompt_text(
            text, settings.user_text_screen_model, settings.llm_run_timeout_seconds
        )
    except UsageLimitExceeded:
        raise
    except Exception:
        logger.exception("Prompt screening failed; generation was blocked")
        raise InputBlocked(UNCHECKED_MESSAGE) from None
    record_guardrail_usage(run.model_name, settings.user_text_screen_model, run.usage)
    if blocks_on_yes_confidence(run.screen, run.confidence):
        raise InputBlocked(BLOCKED_MESSAGE)
    return True


async def _screen_prompt_text(text: str, model: str, timeout_seconds: float) -> Any:
    """Runs Jev asynchronously without applying this guard to the screening agent itself."""
    from agents.user_text_screen_agent import screen_user_message_async

    return await screen_user_message_async(text, model, timeout_seconds)


def _input_text(ctx: RunContext[Any], prompt: str) -> str:
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
    return "\n\n".join(texts)
