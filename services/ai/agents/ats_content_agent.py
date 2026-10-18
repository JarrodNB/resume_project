"""Run bounded, screened content assessment and retry ungrounded evidence."""

import asyncio

from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput
from pydantic_ai.settings import ModelSettings
from pydantic_ai_harness import InputGuardrail

from prompts.ats_content_instructions import ATS_CONTENT_INSTRUCTIONS, ATS_CONTENT_PROMPT_VERSION
from schemas.ats_content import Assessment, Snapshot, validate_assessment
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout
from worker.generative_model import generative_model
from worker.run_limits import agent_usage_limits
from worker.tracing import record_prompt_version

ats_content_agent = Agent(
    name="ats_content_agent",
    deps_type=Snapshot,
    output_type=ToolOutput(Assessment, strict=True),
    instructions=ATS_CONTENT_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[InputGuardrail(guard=screen_prompt)],
)


@ats_content_agent.output_validator
def validate_output(context: RunContext[Snapshot], output: Assessment):
    try:
        return validate_assessment(
            output,
            context.deps.content_snapshot,
            (context.deps.job_snapshot or {}).get("requirements", []),
        )
    except ValueError as error:
        raise ModelRetry(str(error)) from error


async def assess_content(prompt, snapshot, settings):
    """Keep the whole run within task limits and use existing provider usage observation."""
    async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
        with record_prompt_version(ATS_CONTENT_PROMPT_VERSION):
            return await ats_content_agent.run(
                prompt,
                deps=snapshot,
                model=generative_model(
                    settings.gap_analysis_model, settings.generative_fallback_model
                ),
                model_settings=ModelSettings(thinking=settings.gap_analysis_thinking),
                usage_limits=agent_usage_limits(settings),
            )
