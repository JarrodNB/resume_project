"""
Description: Pydantic AI agent that writes one resume section from labeled sources. An output
validator retries until the section cites real labels and doesn't name unsupported claims.
Index:
    - resume_tailoring_agent: the agent (deps: the SectionPrompt; model chosen per run)
    - TailoringRun: the checked draft plus token usage
    - write_resume_section: runs the agent within a time limit
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai.usage import RunUsage

from prompts.resume_tailoring_instructions import RESUME_TAILORING_INSTRUCTIONS
from schemas.tailored_section import TailoredSectionDraft
from tailoring.build_section_prompt import SectionPrompt
from tailoring.check_section_faithfulness import find_section_problems

resume_tailoring_agent = Agent(
    name="resume_tailoring_agent",
    deps_type=SectionPrompt,
    output_type=TailoredSectionDraft,
    instructions=RESUME_TAILORING_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
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


def write_resume_section(
    prompt: SectionPrompt, model: str, thinking: ThinkingEffort, timeout_seconds: float
) -> TailoringRun:
    """Writes one section. Raises TimeoutError if the run exceeds timeout_seconds."""
    return asyncio.run(_run_with_deadline(prompt, model, thinking, timeout_seconds))


async def _run_with_deadline(
    prompt: SectionPrompt, model: str, thinking: ThinkingEffort, timeout_seconds: float
) -> TailoringRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(timeout_seconds):
        result = await resume_tailoring_agent.run(
            prompt.text,
            deps=prompt,
            model=model,
            model_settings=ModelSettings(thinking=thinking),
        )
    return TailoringRun(draft=result.output, usage=result.usage)
