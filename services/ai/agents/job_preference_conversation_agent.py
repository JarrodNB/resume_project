"""Draft next-job preferences or pause for one user clarification through deferred tools."""
import asyncio
import json
from dataclasses import dataclass
from typing import Annotated, NamedTuple

from pydantic import Field
from pydantic_ai import Agent, CallDeferred, DeferredToolRequests, RunContext
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.generative_model import generative_model
from llm.model_prices import reported_model_name
from llm.run_limits import agent_usage_limits
from prompts.job_preference_conversation_instructions import (
    JOB_PREFERENCE_CONVERSATION_INSTRUCTIONS,
    JOB_PREFERENCE_CONVERSATION_PROMPT_VERSION,
)
from schemas.job_preference_conversation import JobPreferenceProposal
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout
from telemetry.tracing import record_prompt_version


@dataclass
class PreferenceConversationDeps:
    allow_question: bool = True


job_preference_conversation_agent = Agent(
    name="job_preference_conversation_agent", deps_type=PreferenceConversationDeps,
    output_type=JobPreferenceProposal | DeferredToolRequests,
    instructions=JOB_PREFERENCE_CONVERSATION_INSTRUCTIONS, retries=1, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)


@job_preference_conversation_agent.tool
def ask_user(ctx: RunContext[PreferenceConversationDeps], question: Annotated[str, Field(min_length=1, max_length=500)]) -> str:
    """Ask one focused question to clarify a desired job condition or its priority."""
    if not ctx.deps.allow_question:
        return "Further questions are disabled. Draft only known preferences without inventing priorities or conditions."
    raise CallDeferred()


class PreferenceConversationRun(NamedTuple):
    output: JobPreferenceProposal | DeferredToolRequests
    history: list[dict]
    usage: RunUsage
    model: str


def propose_job_preferences(prompt, history, deferred, settings, *, allow_question=True):
    """Execute one prepared turn under the existing queue model budgets and accounting."""
    async def execute():
        limits = agent_usage_limits(settings)
        limits.tool_calls_limit = 2
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            with record_prompt_version(JOB_PREFERENCE_CONVERSATION_PROMPT_VERSION):
                run = await job_preference_conversation_agent.run(
                    prompt, message_history=history, deferred_tool_results=deferred,
                    deps=PreferenceConversationDeps(allow_question),
                    model=generative_model(settings.chat_model, settings.generative_fallback_model),
                    model_settings=ModelSettings(thinking=False, parallel_tool_calls=False), usage_limits=limits)
        return PreferenceConversationRun(run.output, json.loads(run.all_messages_json()), run.usage,
            reported_model_name(run.response.model_name or settings.chat_model, settings.chat_model))
    return asyncio.run(execute())
