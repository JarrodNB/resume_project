"""Run the separate editorial agent with standard safety, accounting and execution limits."""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from prompts.resume_editorial_instructions import (
    RESUME_EDITORIAL_INSTRUCTIONS,
    RESUME_EDITORIAL_PROMPT_VERSION,
)
from schemas.resume_document import ResumeEditorialReview
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout, screening_session
from worker.generative_model import generative_model
from worker.model_prices import reported_model_name
from worker.run_limits import agent_usage_limits
from worker.tracing import record_prompt_version

resume_editorial_agent = Agent(
    name="resume_editorial_agent",
    output_type=ResumeEditorialReview,
    instructions=RESUME_EDITORIAL_INSTRUCTIONS,
    retries=0,
    defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)


class ResumeEditorialRun(NamedTuple):
    output: ResumeEditorialReview
    usage: RunUsage
    model: str


async def review_resume_document(prompt: str, settings) -> ResumeEditorialRun:
    """Use an existing task deadline and task-level budget, including provider fallback."""
    with (
        screening_session(settings.llm_run_timeout_seconds, reuse=True),
        record_prompt_version(RESUME_EDITORIAL_PROMPT_VERSION),
    ):
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            result = await resume_editorial_agent.run(
                prompt,
                model=generative_model(
                    settings.resume_tailoring_model, settings.generative_fallback_model
                ),
                model_settings=ModelSettings(thinking=settings.resume_tailoring_thinking),
                usage_limits=agent_usage_limits(settings),
            )
    return ResumeEditorialRun(
        result.output,
        result.usage,
        reported_model_name(
            result.response.model_name or settings.resume_tailoring_model,
            settings.resume_tailoring_model,
        ),
    )
