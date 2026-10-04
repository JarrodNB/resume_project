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

from job_postings.extract_job_posting import BulletSortingRun
from prompts.job_requirements_sorting_instructions import JOB_REQUIREMENTS_SORTING_INSTRUCTIONS
from schemas.sorted_requirement_bullets import SortedRequirementBullets

job_requirements_sorting_agent = Agent(
    name="job_requirements_sorting_agent",
    output_type=SortedRequirementBullets,
    instructions=JOB_REQUIREMENTS_SORTING_INSTRUCTIONS,
    defer_model_check=True,
)


def format_numbered_bullets(bullets: list[str]) -> str:
    """Numbers bullets from 1, matching pick_sorted_bullets."""
    return "\n".join(f"{number}. {bullet}" for number, bullet in enumerate(bullets, start=1))


def sort_job_requirement_bullets(
    bullets: list[str], model: str, thinking: ThinkingEffort, timeout_seconds: float
) -> BulletSortingRun:
    """Sorts the bullets with the given model and reasoning effort. Raises TimeoutError if the
    whole run takes longer than timeout_seconds."""
    return asyncio.run(_run_with_deadline(bullets, model, thinking, timeout_seconds))


async def _run_with_deadline(
    bullets: list[str], model: str, thinking: ThinkingEffort, timeout_seconds: float
) -> BulletSortingRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(timeout_seconds):
        result = await job_requirements_sorting_agent.run(
            format_numbered_bullets(bullets),
            model=model,
            model_settings=ModelSettings(thinking=thinking),
        )
    return BulletSortingRun(sorted_bullets=result.output, usage=result.usage)
