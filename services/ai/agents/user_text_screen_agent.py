"""
Description: Pydantic AI agent that asks Jev two yes/no questions about one user-written
message. The screening policy owns recovery; this agent only runs JEV with a three-second cap.
Index:
    - user_text_screen_agent: the agent (model chosen per run; output UserTextScreen)
    - UserTextScreenRun: the judgement, the response's model name, and token usage
    - screen_user_message: runs the agent within a time limit
    - screen_user_message_async: same bounded run for async input guardrails
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent
from pydantic_ai.models.decision import DecisionModelSettings
from pydantic_ai.usage import RunUsage

from conversation_logging import ConversationLogging
from prompts.user_text_screen_instructions import (
    USER_TEXT_SCREEN_INSTRUCTIONS,
    USER_TEXT_SCREEN_PROMPT_VERSION,
)
from schemas.user_text_screen import UserTextScreen
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.task_usage import accounted_model
from worker.tracing import record_prompt_version

# The default bar. yes_probability() recovers P(yes) from this and the reported margin.
# screening/yes_confidence.py must use the same value.
BOOLEAN_THRESHOLD = 0.5
JEV_REQUEST_TIMEOUT_SECONDS = 3.0

user_text_screen_agent = Agent(
    name="user_text_screen_agent",
    output_type=UserTextScreen,
    instructions=USER_TEXT_SCREEN_INSTRUCTIONS,
    defer_model_check=True,
    capabilities=[ConversationLogging()],
)


class UserTextScreenRun(NamedTuple):
    """What one Jev call returned."""

    screen: UserTextScreen
    model_name: str
    confidence: dict[str, float]
    usage: RunUsage


def screen_user_message(text: str, model: str, timeout_seconds: float) -> UserTextScreenRun:
    """Asks Jev about `text`. Raises if the call fails, times out, or passes its request,
    tool-call, or token cap. A provider failure is fail-closed in the caller; a run limit
    fails the task."""
    return asyncio.run(screen_user_message_async(text, model, timeout_seconds))


async def screen_user_message_async(text: str, model: str, timeout_seconds: float) -> UserTextScreenRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(min(JEV_REQUEST_TIMEOUT_SECONDS, timeout_seconds)):
        with record_prompt_version(USER_TEXT_SCREEN_PROMPT_VERSION):
            result = await user_text_screen_agent.run(
                text,
                model=accounted_model(model),
                model_settings=DecisionModelSettings(decision_boolean_threshold=BOOLEAN_THRESHOLD),
                usage_limits=agent_usage_limits(load_settings()),
            )
    details = result.response.provider_details or {}
    confidence = details.get("confidence") or {}
    return UserTextScreenRun(
        screen=result.output,
        model_name=result.response.model_name or model,
        confidence={key: float(value) for key, value in confidence.items()},
        usage=result.usage,
    )
