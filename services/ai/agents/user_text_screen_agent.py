"""
Description: Pydantic AI agent that asks Jev two yes/no questions about one user-written
message. There is no generative model behind it: a failed call fails closed in the caller.
Index:
    - user_text_screen_agent: the agent (model chosen per run; output UserTextScreen)
    - UserTextScreenRun: the judgement, the response's model name, and token usage
    - screen_user_message: runs the agent within a time limit
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent
from pydantic_ai.models.decision import DecisionModelSettings
from pydantic_ai.usage import RunUsage

from prompts.user_text_screen_instructions import USER_TEXT_SCREEN_INSTRUCTIONS
from schemas.user_text_screen import UserTextScreen

# The default bar. yes_probability() recovers P(yes) from this and the reported margin.
# screening/yes_confidence.py must use the same value.
BOOLEAN_THRESHOLD = 0.5

user_text_screen_agent = Agent(
    name="user_text_screen_agent",
    output_type=UserTextScreen,
    instructions=USER_TEXT_SCREEN_INSTRUCTIONS,
    defer_model_check=True,
)


class UserTextScreenRun(NamedTuple):
    """What one Jev call returned."""

    screen: UserTextScreen
    model_name: str
    confidence: dict[str, float]
    usage: RunUsage


def screen_user_message(text: str, model: str, timeout_seconds: float) -> UserTextScreenRun:
    """Asks Jev about `text`. Raises if the call fails or times out; the caller fails closed."""
    return asyncio.run(_run_with_deadline(text, model, timeout_seconds))


async def _run_with_deadline(text: str, model: str, timeout_seconds: float) -> UserTextScreenRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(timeout_seconds):
        result = await user_text_screen_agent.run(
            text,
            model=model,
            model_settings=DecisionModelSettings(decision_boolean_threshold=BOOLEAN_THRESHOLD),
        )
    details = result.response.provider_details or {}
    confidence = details.get("confidence") or {}
    return UserTextScreenRun(
        screen=result.output,
        model_name=result.response.model_name or model,
        confidence={key: float(value) for key, value in confidence.items()},
        usage=result.usage,
    )
