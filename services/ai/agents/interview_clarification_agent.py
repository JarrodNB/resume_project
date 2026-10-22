"""Explain one screened question under a short shared deadline and small generation budget."""
import asyncio

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from prompts.interview_clarification_instructions import (
    INTERVIEW_CLARIFICATION_INSTRUCTIONS,
    INTERVIEW_CLARIFICATION_PROMPT_VERSION,
)
from schemas.interview_clarification import InterviewClarification
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout
from worker.generative_model import generative_model
from worker.tracing import record_prompt_version

interview_clarification_agent = Agent(name="interview_clarification_agent", output_type=InterviewClarification,
    instructions=INTERVIEW_CLARIFICATION_INSTRUCTIONS, retries=0, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)])


def generate_interview_clarification(prompt, settings):
    """Use the configured interview model, one fallback and no output-repair loop."""
    async def run():
        async with asyncio.timeout(remaining_timeout(min(settings.llm_run_timeout_seconds, 30))):
            with record_prompt_version(INTERVIEW_CLARIFICATION_PROMPT_VERSION):
                return await interview_clarification_agent.run(prompt,
                    model=generative_model(settings.interview_questions_model, settings.generative_fallback_model),
                    model_settings=ModelSettings(thinking="low", max_tokens=1000),
                    usage_limits=UsageLimits(request_limit=2, tool_calls_limit=0,
                        output_tokens_limit=2000, total_tokens_limit=6000))
    return asyncio.run(run())
