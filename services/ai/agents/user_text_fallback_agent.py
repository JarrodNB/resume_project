"""Classify prompt injection with the configured screening LLM.

This classifier has no input guardrail because it only judges untrusted input. Concrete
responses are accounted before validation, so retries and failures keep their real costs.
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage

from conversation_logging import ConversationLogging
from llm.run_limits import agent_usage_limits
from llm.usage import accounted_model
from model_inputs.safety import format_fallback_input
from prompts.user_text_fallback_instructions import (
    USER_TEXT_FALLBACK_INSTRUCTIONS,
    USER_TEXT_FALLBACK_PROMPT_VERSION,
)
from schemas.user_text_fallback import UserTextFallbackScreen
from settings import load_settings
from telemetry.tracing import record_prompt_version

user_text_fallback_agent = Agent(
    name="user_text_fallback_agent", output_type=UserTextFallbackScreen,
    instructions=USER_TEXT_FALLBACK_INSTRUCTIONS, defer_model_check=True,
    capabilities=[ConversationLogging()],
)


class UserTextFallbackRun(NamedTuple):
    """The fallback's boolean answers and actual model usage."""

    screen: UserTextFallbackScreen
    model_name: str
    usage: RunUsage


def screen_fallback_message(text: str, model: str, timeout_seconds: float) -> UserTextFallbackRun:
    """Run the same fallback policy for synchronous handlers."""
    return asyncio.run(screen_fallback_message_async(text, model, timeout_seconds))


async def screen_fallback_message_async(
    text: str, model: str, timeout_seconds: float,
) -> UserTextFallbackRun:
    """Classify only; cancellation and usage-limit errors remain visible to the caller."""
    async with asyncio.timeout(timeout_seconds):
        with record_prompt_version(USER_TEXT_FALLBACK_PROMPT_VERSION):
            result = await user_text_fallback_agent.run(
                format_fallback_input(text), model=accounted_model(model),
                model_settings=ModelSettings(thinking="low"),
                usage_limits=agent_usage_limits(load_settings()),
            )
    return UserTextFallbackRun(result.output, result.response.model_name or model, result.usage)
