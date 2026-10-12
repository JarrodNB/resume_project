"""
Description: Pydantic AI agent that compares a job's requirements with the user's career library
and returns a verdict (met, partial, missing) and cited evidence labels for each requirement. An
output validator retries the model until every requirement is assessed once and every cited
label exists.
Index:
    - gap_analysis_agent: the agent (deps: the GapAnalysisPrompt; model and effort chosen per run)
    - GapAnalysisRun: the validated analysis, token usage, and the model name to bill
    - analyze_gaps: runs the agent within a time limit
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputGuardrail

from gap_analysis.build_gap_analysis_prompt import GapAnalysisPrompt
from gap_analysis.find_gap_analysis_problems import find_gap_analysis_problems
from prompts.gap_analysis_instructions import GAP_ANALYSIS_INSTRUCTIONS, GAP_ANALYSIS_PROMPT_VERSION
from schemas.gap_analysis import GapAnalysis
from screening.prompt_guardrail import screen_prompt
from worker.generative_model import generative_model
from worker.model_prices import reported_model_name
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.tracing import record_prompt_version

gap_analysis_agent = Agent(
    name="gap_analysis_agent",
    deps_type=GapAnalysisPrompt,
    output_type=GapAnalysis,
    instructions=GAP_ANALYSIS_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[InputGuardrail(guard=screen_prompt)],
)


@gap_analysis_agent.output_validator
def check_labels(context: RunContext[GapAnalysisPrompt], analysis: GapAnalysis) -> GapAnalysis:
    """Sends label problems back to the model to fix."""
    problems = find_gap_analysis_problems(analysis, context.deps)
    if problems:
        raise ModelRetry("Fix these problems and answer again:\n- " + "\n- ".join(problems))
    return analysis


class GapAnalysisRun(NamedTuple):
    """What one agent run produced."""

    gap_analysis: GapAnalysis
    usage: RunUsage
    model: str = ""


def analyze_gaps(
    prompt: GapAnalysisPrompt,
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> GapAnalysisRun:
    """Runs the agent on a built prompt. Raises TimeoutError if the whole run takes longer than
    timeout_seconds. Raises UsageLimitExceeded when the run passes its request, tool-call, or
    token cap. A provider error tries fallback_model."""
    return asyncio.run(_run_with_deadline(prompt, model, thinking, timeout_seconds, fallback_model))


async def _run_with_deadline(
    prompt: GapAnalysisPrompt,
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> GapAnalysisRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(timeout_seconds):
        with record_prompt_version(GAP_ANALYSIS_PROMPT_VERSION):
            result = await gap_analysis_agent.run(
                prompt.text,
                deps=prompt,
                model=generative_model(model, fallback_model),
                model_settings=ModelSettings(thinking=thinking),
                usage_limits=agent_usage_limits(load_settings()),
            )
    return GapAnalysisRun(
        gap_analysis=result.output,
        usage=result.usage,
        model=reported_model_name(result.response.model_name or model, model),
    )
