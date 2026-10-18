"""Run bounded, screened content assessment and retry ungrounded evidence."""

import asyncio
from copy import deepcopy
from dataclasses import replace

from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput
from pydantic_ai.capabilities import PrepareOutputTools
from pydantic_ai.settings import ModelSettings
from pydantic_ai.tools import ToolDefinition
from pydantic_ai_harness import InputGuardrail

from pii import PiiRestorationError, validate_privacy_markers
from prompts.ats_content_instructions import ATS_CONTENT_INSTRUCTIONS, ATS_CONTENT_PROMPT_VERSION
from schemas.ats_evidence import (
    AssessmentContext,
    AssessmentSelection,
    build_evidence_catalog,
    expand_assessment,
)
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout
from worker.generative_model import generative_model
from worker.run_limits import agent_usage_limits
from worker.tracing import record_prompt_version


def bind_evidence_references(context: RunContext[AssessmentContext], tools: list[ToolDefinition]):
    """Limit model choices to opaque references from the protected source catalog."""
    references = [item.id for item in context.deps.evidence_catalog]
    prepared = []
    for tool in tools:
        schema = deepcopy(tool.parameters_json_schema)
        for name in ("RequirementSelection", "CheckSelection"):
            field = schema["$defs"][name]["properties"]["evidence_ids"]
            if references:
                field["items"]["enum"] = references
            else:
                # An empty enum is invalid for the provider; only an empty list is valid here.
                field["maxItems"] = 0
        prepared.append(replace(tool, parameters_json_schema=schema))
    return prepared


ats_content_agent = Agent(
    name="ats_content_agent",
    deps_type=AssessmentContext,
    output_type=ToolOutput(AssessmentSelection, strict=True),
    instructions=ATS_CONTENT_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[
        InputGuardrail(guard=screen_prompt),
        PrepareOutputTools(bind_evidence_references),
    ],
)


@ats_content_agent.output_validator
def validate_output(context: RunContext[AssessmentContext], output: AssessmentSelection):
    try:
        validate_privacy_markers(output, protected_source=context.deps.snapshot)
    except PiiRestorationError:
        raise ModelRetry(
            "Rewrite explanatory and action text without invented or incomplete privacy markers. "
            "Refer to protected contact details generically; keep evidence references unchanged."
        ) from None
    try:
        expand_assessment(output, context.deps)
        return output
    except ValueError as error:
        title_refs = [
            item.id for item in context.deps.evidence_catalog if item.field_path == "title"
        ]
        raise ModelRetry(
            str(error) + " Use evidence_ids to select existing evidence_catalog IDs; never write "
            "free-form quotes. A section-title reference may locate a missing field. Valid title "
            f"reference IDs: {title_refs!r}. Correct evidence for every applicable check."
        ) from error


async def assess_content(prompt, snapshot, settings, *, evidence_catalog=None):
    """Keep the whole run within task limits and use existing provider usage observation."""
    context = AssessmentContext(
        snapshot=snapshot,
        evidence_catalog=build_evidence_catalog(snapshot.content_snapshot)
        if evidence_catalog is None
        else evidence_catalog,
    )
    async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
        with record_prompt_version(ATS_CONTENT_PROMPT_VERSION):
            result = await ats_content_agent.run(
                prompt,
                deps=context,
                model=generative_model(
                    settings.gap_analysis_model, settings.generative_fallback_model
                ),
                model_settings=ModelSettings(thinking=settings.gap_analysis_thinking),
                usage_limits=agent_usage_limits(settings),
            )

    return replace(result, output=expand_assessment(result.output, context))
