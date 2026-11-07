"""Generate bounded study material without injection classification."""

from pydantic_ai import Agent
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.run_generative_agent import run_generative_agent
from llm.run_limits import agent_usage_limits
from prompts.study_guide_instructions import STUDY_GUIDE_INSTRUCTIONS, STUDY_GUIDE_PROMPT_VERSION
from schemas.study_guide import StudyGuide, StudyGuideUnavailable
from text_limits import MAX_PROMPT_TEXT


async def check_study_guide_input(ctx, prompt):
    """Keep a bounded text-only input without calling an injection classifier."""
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_TEXT:
        raise ValueError("Study guide input must be bounded nonblank text")
    return True


study_guide_agent = Agent(name="study_guide_agent", output_type=[StudyGuide, StudyGuideUnavailable],
    instructions=STUDY_GUIDE_INSTRUCTIONS, retries=2, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=check_study_guide_input)])


def generate_study_guide(prompt, settings):
    """Return validated output; provider failures use the shared fallback policy."""
    return run_generative_agent(
        study_guide_agent, prompt, model=settings.study_guide_model,
        fallback_model=settings.generative_fallback_model, thinking=settings.study_guide_thinking,
        timeout_seconds=settings.llm_run_timeout_seconds, prompt_version=STUDY_GUIDE_PROMPT_VERSION,
        usage_limits=agent_usage_limits(settings),
    ).output
