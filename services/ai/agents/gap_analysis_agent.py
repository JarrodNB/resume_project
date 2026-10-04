"""
Description: Pydantic AI agent that compares a job's requirements with the user's career library
and returns a verdict (met, partial, missing) and cited evidence labels for each requirement. An
output validator retries the model until every requirement is assessed once and every cited
label exists.
Index:
    - gap_analysis_agent: the agent (deps: the GapAnalysisPrompt; model and effort chosen per run)
    - GapAnalysisRun: the validated analysis plus the run's token usage
    - analyze_gaps: runs the agent within a time limit
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai.usage import RunUsage

from gap_analysis.build_gap_analysis_prompt import GapAnalysisPrompt
from gap_analysis.find_gap_analysis_problems import find_gap_analysis_problems
from prompts.gap_analysis_instructions import GAP_ANALYSIS_INSTRUCTIONS
from schemas.gap_analysis import GapAnalysis

gap_analysis_agent = Agent(
    name="gap_analysis_agent",
    deps_type=GapAnalysisPrompt,
    output_type=GapAnalysis,
    instructions=GAP_ANALYSIS_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
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


def analyze_gaps(
    prompt: GapAnalysisPrompt, model: str, thinking: ThinkingEffort, timeout_seconds: float
) -> GapAnalysisRun:
    """Runs the agent on a built prompt. Raises TimeoutError if the whole run takes longer than
    timeout_seconds."""
    return asyncio.run(_run_with_deadline(prompt, model, thinking, timeout_seconds))


async def _run_with_deadline(
    prompt: GapAnalysisPrompt, model: str, thinking: ThinkingEffort, timeout_seconds: float
) -> GapAnalysisRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(timeout_seconds):
        result = await gap_analysis_agent.run(
            prompt.text,
            deps=prompt,
            model=model,
            model_settings=ModelSettings(thinking=thinking),
        )
    return GapAnalysisRun(gap_analysis=result.output, usage=result.usage)
