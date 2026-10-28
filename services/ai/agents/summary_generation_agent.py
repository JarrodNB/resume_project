"""Write one absent summary behind the ordinary guarded, traced model interface."""
import asyncio
from dataclasses import dataclass

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ModelSettings
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.generative_model import generative_model
from llm.run_limits import agent_usage_limits
from prompts.summary_generation_instructions import (
    SUMMARY_GENERATION_INSTRUCTIONS,
    SUMMARY_GENERATION_PROMPT_VERSION,
)
from schemas.summary_generation import SummaryProposal
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout
from telemetry.tracing import record_prompt_version


@dataclass
class SummaryGenerationDeps:
    labels: set[str]


summary_generation_agent = Agent(name="summary_generation_agent", deps_type=SummaryGenerationDeps,
    output_type=SummaryProposal, instructions=SUMMARY_GENERATION_INSTRUCTIONS,
    retries=2, defer_model_check=True, capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)])


@summary_generation_agent.output_validator
def validate_summary(ctx: RunContext[SummaryGenerationDeps], output: SummaryProposal):
    if not output.text.strip() or len(set(output.source_labels)) != len(output.source_labels) or not set(output.source_labels) <= ctx.deps.labels:
        raise ModelRetry("Write nonblank summary text and cite only distinct supplied source labels.")
    return output


def generate_summary(prompt, labels, settings):
    async def run():
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            with record_prompt_version(SUMMARY_GENERATION_PROMPT_VERSION):
                return await summary_generation_agent.run(prompt, deps=SummaryGenerationDeps(set(labels)),
                    model=generative_model(settings.library_edit_model, settings.generative_fallback_model),
                    model_settings=ModelSettings(thinking=settings.library_edit_thinking), usage_limits=agent_usage_limits(settings))
    return asyncio.run(run())
