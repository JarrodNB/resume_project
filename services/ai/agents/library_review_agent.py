"""Review a selected section with grades and focused questions for missing career evidence.

Only short target labels reach the model. The handler maps them back to saved fields.
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.generative_model import generative_model
from llm.model_prices import reported_model_name
from llm.run_limits import agent_usage_limits
from prompts.library_review_instructions import (
    LIBRARY_REVIEW_INSTRUCTIONS,
    LIBRARY_REVIEW_PROMPT_VERSION,
)
from schemas.library_review import LibraryReviewDraft
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout, within_screening_session
from settings import AISettings
from telemetry.tracing import record_prompt_version

library_review_agent = Agent(
    name="library_review_agent", deps_type=list[str], output_type=LibraryReviewDraft,
    instructions=LIBRARY_REVIEW_INSTRUCTIONS, retries=2, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)


@library_review_agent.output_validator
def check_targets(ctx: RunContext[list[str]], output: LibraryReviewDraft) -> LibraryReviewDraft:
    labels = [item.target_label for item in output.assessments]
    if len(labels) != len(set(labels)) or set(labels) != set(ctx.deps):
        raise ModelRetry("Assess every supplied target label exactly once. Do not add labels.")
    if any(not item.reason.strip() for item in output.assessments):
        raise ModelRetry("Give a nonblank reason for each assessment.")
    if any(item.question is not None and not item.question.strip() for item in output.assessments):
        raise ModelRetry("Use null when no question is needed; otherwise ask a nonblank question.")
    return output


class LibraryReviewRun(NamedTuple):
    draft: LibraryReviewDraft
    usage: RunUsage
    model: str


@within_screening_session
def review_library_section(prompt: str, labels: list[str], settings: AISettings) -> LibraryReviewRun:
    """Run the agent within the shared execution deadline and configured model budgets."""
    return asyncio.run(_review(prompt, labels, settings))


async def _review(prompt, labels, settings):
    async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
        with record_prompt_version(LIBRARY_REVIEW_PROMPT_VERSION):
            result = await library_review_agent.run(
                prompt, deps=labels,
                model=generative_model(settings.library_review_model, settings.generative_fallback_model),
                model_settings=ModelSettings(thinking=settings.library_review_thinking),
                usage_limits=agent_usage_limits(settings),
            )
    return LibraryReviewRun(result.output, result.usage, reported_model_name(
        result.response.model_name or settings.library_review_model, settings.library_review_model,
    ))
