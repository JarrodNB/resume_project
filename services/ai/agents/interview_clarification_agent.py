"""Explain one screened question under a short shared deadline and small generation budget."""

from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.run_generative_agent import run_generative_agent
from prompts.interview_clarification_instructions import (
    INTERVIEW_CLARIFICATION_INSTRUCTIONS,
    INTERVIEW_CLARIFICATION_PROMPT_VERSION,
)
from schemas.interview_clarification import InterviewClarification
from screening.prompt_guardrail import screen_prompt

interview_clarification_agent = Agent(name="interview_clarification_agent", output_type=InterviewClarification,
    instructions=INTERVIEW_CLARIFICATION_INSTRUCTIONS, retries=0, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)])


def generate_interview_clarification(prompt, settings):
    """Use the configured interview model, one fallback and no output-repair loop."""
    return run_generative_agent(
        interview_clarification_agent, prompt, model=settings.interview_questions_model,
        fallback_model=settings.generative_fallback_model, thinking="low",
        timeout_seconds=min(settings.llm_run_timeout_seconds, 30),
        prompt_version=INTERVIEW_CLARIFICATION_PROMPT_VERSION, model_settings={"max_tokens": 1000},
        usage_limits=UsageLimits(request_limit=2, tool_calls_limit=0,
                                 output_tokens_limit=2000, total_tokens_limit=6000),
    ).output
