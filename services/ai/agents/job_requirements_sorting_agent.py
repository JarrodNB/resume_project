"""
Description: Pydantic AI agent that sorts a job posting's numbered bullets into requirements and
nice-to-haves. It answers with bullet numbers only, so it can't reword anything. Used only when
the posting's headings don't say which bullets are requirements.
Index:
    - job_requirements_sorting_agent: the agent (model and reasoning effort are chosen per run)
    - format_numbered_bullets: the user prompt ("1. ...", one bullet per line)
    - sort_job_requirement_bullets: runs the agent within a time limit
"""

import asyncio

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai_harness import InputGuardrail

from job_postings.extract_job_posting import BulletSortingRun
from prompts.job_requirements_sorting_instructions import (
    JOB_REQUIREMENTS_SORTING_INSTRUCTIONS,
    JOB_REQUIREMENTS_SORTING_PROMPT_VERSION,
)
from schemas.sorted_requirement_bullets import SortedRequirementBullets
from screening.prompt_guardrail import screen_prompt
from screening.session import bind_screened_prompt, remaining_timeout, within_screening_session
from worker.generative_model import generative_model
from worker.model_prices import reported_model_name
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.tracing import record_prompt_version

job_requirements_sorting_agent = Agent(
    name="job_requirements_sorting_agent",
    output_type=SortedRequirementBullets,
    instructions=JOB_REQUIREMENTS_SORTING_INSTRUCTIONS,
    defer_model_check=True,
    capabilities=[InputGuardrail(guard=screen_prompt)],
)


def format_numbered_bullets(bullets: list[str]) -> str:
    """Numbers bullets from 1, matching pick_sorted_bullets."""
    return "\n".join(f"{number}. {bullet}" for number, bullet in enumerate(bullets, start=1))


@within_screening_session
def sort_job_requirement_bullets(
    bullets: list[str],
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> BulletSortingRun:
    """Sorts the bullets with the given model and reasoning effort. Raises TimeoutError if the
    whole run takes longer than timeout_seconds. Raises UsageLimitExceeded when the run passes
    its request, tool-call, or token cap. A provider error tries fallback_model."""
    return asyncio.run(
        _run_with_deadline(bullets, model, thinking, timeout_seconds, fallback_model)
    )


async def _run_with_deadline(
    bullets: list[str],
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> BulletSortingRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(remaining_timeout(timeout_seconds)):
        with record_prompt_version(JOB_REQUIREMENTS_SORTING_PROMPT_VERSION):
            result = await job_requirements_sorting_agent.run(
                bind_screened_prompt([format_numbered_bullets(bullets)], lambda sources: sources[0]),
                model=generative_model(model, fallback_model),
                model_settings=ModelSettings(thinking=thinking),
                usage_limits=agent_usage_limits(load_settings()),
            )
    return BulletSortingRun(
        sorted_bullets=result.output,
        usage=result.usage,
        model=reported_model_name(result.response.model_name or model, model),
    )
