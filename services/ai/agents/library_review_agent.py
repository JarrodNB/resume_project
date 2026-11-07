"""Review a selected section with grades and focused questions for missing career evidence.

Only short target labels reach the model. The handler maps them back to saved fields.
"""

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.run_generative_agent import run_generative_agent
from llm.run_limits import agent_usage_limits
from prompts.library_review_instructions import (
    LIBRARY_REVIEW_INSTRUCTIONS,
    LIBRARY_REVIEW_PROMPT_VERSION,
)
from schemas.library_review import LibraryReviewDraft
from screening.prompt_guardrail import screen_prompt
from settings import AISettings

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


def review_library_section(prompt: str, labels: list[str], settings: AISettings) -> LibraryReviewDraft:
    """Run the agent within the shared execution deadline and configured model budgets."""
    return run_generative_agent(
        library_review_agent, prompt, deps=labels, model=settings.library_review_model,
        fallback_model=settings.generative_fallback_model, thinking=settings.library_review_thinking,
        timeout_seconds=settings.llm_run_timeout_seconds, prompt_version=LIBRARY_REVIEW_PROMPT_VERSION,
        usage_limits=agent_usage_limits(settings),
    ).output
