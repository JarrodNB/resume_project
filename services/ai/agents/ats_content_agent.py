"""Run bounded, screened content assessment and retry ungrounded evidence."""

import asyncio
from copy import deepcopy
from dataclasses import replace

from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput
from pydantic_ai.capabilities import PrepareOutputTools
from pydantic_ai.settings import ModelSettings
from pydantic_ai.tools import ToolDefinition
from pydantic_ai_harness import InputGuardrail

from prompts.ats_content_instructions import ATS_CONTENT_INSTRUCTIONS, ATS_CONTENT_PROMPT_VERSION
from schemas.ats_content import Assessment, Snapshot, validate_assessment
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout
from worker.generative_model import generative_model
from worker.run_limits import agent_usage_limits
from worker.tracing import record_prompt_version


def bind_evidence_section_ids(context: RunContext[Snapshot], tools: list[ToolDefinition]):
    """Restrict evidence to exact saved identifiers before provider serialization."""
    section_ids = list(
        dict.fromkeys(
            str(section.get("id", section.get("position")))
            for section in context.deps.content_snapshot
        )
    )
    if not section_ids:
        # Empty snapshots permit no evidence; the existing runtime validator enforces that.
        return tools
    prepared = []
    for tool in tools:
        # Schemas are shared by the agent, so bind a separate copy for each concurrent run.
        schema = deepcopy(tool.parameters_json_schema)
        schema["$defs"]["Evidence"]["properties"]["section_id"]["enum"] = section_ids
        prepared.append(replace(tool, parameters_json_schema=schema))
    return prepared


ats_content_agent = Agent(
    name="ats_content_agent",
    deps_type=Snapshot,
    output_type=ToolOutput(Assessment, strict=True),
    instructions=ATS_CONTENT_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[
        InputGuardrail(guard=screen_prompt),
        PrepareOutputTools(bind_evidence_section_ids),
    ],
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
