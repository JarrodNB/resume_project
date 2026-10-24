"""Classify input when JEV is unavailable, within the remaining screening deadline.

This classifier has no input guardrail because it only judges untrusted input. Concrete
responses are accounted before validation, so retries and failures keep their real costs.
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage

from conversation_logging import ConversationLogging
from prompts.user_text_fallback_instructions import (
    USER_TEXT_FALLBACK_INSTRUCTIONS,
    USER_TEXT_FALLBACK_PROMPT_VERSION,
)
from schemas.user_text_fallback import UserTextFallbackScreen
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.task_usage import accounted_model
from worker.tracing import record_prompt_version

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
    quoted_text = "\n".join(f"| {line}" for line in text.split("\n"))
    async with asyncio.timeout(timeout_seconds):
        with record_prompt_version(USER_TEXT_FALLBACK_PROMPT_VERSION):
            result = await user_text_fallback_agent.run(
                f"<user_text>\n{quoted_text}\n</user_text>", model=accounted_model(model),
                model_settings=ModelSettings(thinking="low"),
                usage_limits=agent_usage_limits(load_settings()),
            )
    return UserTextFallbackRun(result.output, result.response.model_name or model, result.usage)
