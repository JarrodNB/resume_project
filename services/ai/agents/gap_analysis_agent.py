"""
Description: Pydantic AI agent that compares a job's requirements with the user's career library
and returns a verdict (met, partial, missing) and cited evidence labels for each requirement. An
output validator retries the model until every requirement is assessed once and every cited
label exists.
Index:
    - gap_analysis_agent: the agent (deps: the GapAnalysisPrompt; model and effort chosen per run)
    - analyze_gaps: runs the agent within a time limit
"""

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ThinkingLevel
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from gap_analysis.build_gap_analysis_prompt import GapAnalysisPrompt
from gap_analysis.find_gap_analysis_problems import find_gap_analysis_problems
from llm.run_generative_agent import run_generative_agent
from prompts.gap_analysis_instructions import GAP_ANALYSIS_INSTRUCTIONS, GAP_ANALYSIS_PROMPT_VERSION
from schemas.gap_analysis import GapAnalysis
from screening.prompt_guardrail import screen_prompt
from screening.session import within_screening_session

gap_analysis_agent = Agent(
    name="gap_analysis_agent",
    deps_type=GapAnalysisPrompt,
    output_type=GapAnalysis,
    instructions=GAP_ANALYSIS_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)


@gap_analysis_agent.output_validator
def check_labels(context: RunContext[GapAnalysisPrompt], analysis: GapAnalysis) -> GapAnalysis:
    """Sends label problems back to the model to fix."""
    problems = find_gap_analysis_problems(analysis, context.deps)
    if problems:
        raise ModelRetry("Fix these problems and answer again:\n- " + "\n- ".join(problems))
    return analysis


@within_screening_session
def analyze_gaps(
    prompt: GapAnalysisPrompt,
    model: str,
    thinking: ThinkingLevel,
    timeout_seconds: float,
    fallback_model: str,
) -> GapAnalysis:
    """Runs the agent on a built prompt. Raises TimeoutError if the whole run takes longer than
    timeout_seconds. Raises UsageLimitExceeded when the run passes its request, tool-call, or
    token cap. A provider error tries fallback_model."""
    return run_generative_agent(
        gap_analysis_agent, prompt.text, deps=prompt, model=model, fallback_model=fallback_model,
        thinking=thinking, timeout_seconds=timeout_seconds, prompt_version=GAP_ANALYSIS_PROMPT_VERSION,
    ).output
