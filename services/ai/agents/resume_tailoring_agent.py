"""Write a resume section from screened labeled evidence and check its claims.

The async entry supports concurrent complete-draft generation. A sync entry remains for
standalone section evaluation. Both share validation, provider accounting, and deadlines.
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputGuardrail

from prompts.resume_tailoring_instructions import (
    RESUME_TAILORING_INSTRUCTIONS,
    RESUME_TAILORING_PROMPT_VERSION,
)
from schemas.tailored_section import TailoredSectionDraft
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout, screening_session, within_screening_session
from tailoring.build_section_prompt import SectionPrompt
from tailoring.check_section_faithfulness import find_section_problems
from worker.generative_model import generative_model
from worker.model_prices import reported_model_name
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.tracing import record_prompt_version

resume_tailoring_agent = Agent(
    name="resume_tailoring_agent",
    deps_type=SectionPrompt,
    output_type=TailoredSectionDraft,
    instructions=RESUME_TAILORING_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[InputGuardrail(guard=screen_prompt)],
)


@resume_tailoring_agent.output_validator
def check_faithfulness(
    context: RunContext[SectionPrompt], draft: TailoredSectionDraft
) -> TailoredSectionDraft:
    """Sends unsupported claims back to the model. Does not substitute library text."""
    problems = find_section_problems(context.deps.section_type, draft, context.deps.sources)
    if problems:
        raise ModelRetry("Fix these problems and answer again:\n- " + "\n- ".join(problems))
    return draft


class TailoringRun(NamedTuple):
    """What one section run produced."""

    draft: TailoredSectionDraft
    usage: RunUsage
    model: str = ""


@within_screening_session
def write_resume_section(
    prompt: SectionPrompt,
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> TailoringRun:
    """Writes one section. Raises TimeoutError if the run exceeds timeout_seconds.
    Raises UsageLimitExceeded when the run passes its request, tool-call, or token cap.
    A provider error tries fallback_model."""
    return asyncio.run(write_resume_section_async(prompt, model, thinking, timeout_seconds, fallback_model))


async def write_resume_section_async(
    prompt: SectionPrompt,
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> TailoringRun:
    """Write a section within an existing async task, retaining its execution contexts."""
    with screening_session(timeout_seconds, reuse=True), record_prompt_version(RESUME_TAILORING_PROMPT_VERSION):
        async with asyncio.timeout(remaining_timeout(timeout_seconds)):
            result = await resume_tailoring_agent.run(
                prompt.text,
                deps=prompt,
                model=generative_model(model, fallback_model),
                model_settings=ModelSettings(thinking=thinking),
                usage_limits=agent_usage_limits(load_settings()),
            )
    return TailoringRun(
        draft=result.output,
        usage=result.usage,
        model=reported_model_name(result.response.model_name or model, model),
    )
