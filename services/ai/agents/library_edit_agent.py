"""Improve one library field, pausing through Pydantic AI when a fact needs a user answer."""

import asyncio
import json
from dataclasses import dataclass
from typing import Annotated, NamedTuple

from pydantic import Field
from pydantic_ai import (
    Agent,
    CallDeferred,
    DeferredToolRequests,
    ModelRetry,
    RunContext,
)
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from prompts.library_edit_instructions import LIBRARY_EDIT_INSTRUCTIONS, LIBRARY_EDIT_PROMPT_VERSION
from schemas.library_edit import LibraryEditDraft
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout
from worker.generative_model import generative_model
from worker.model_prices import reported_model_name
from worker.run_limits import agent_usage_limits
from worker.tracing import record_prompt_version


@dataclass
class LibraryEditDeps:
    text_limit: int
    allow_question: bool = True


library_edit_agent = Agent(
    name="library_edit_agent", deps_type=LibraryEditDeps,
    output_type=LibraryEditDraft | DeferredToolRequests,
    instructions=LIBRARY_EDIT_INSTRUCTIONS, retries=2, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)


@library_edit_agent.tool
def ask_user(ctx: RunContext[LibraryEditDeps], question: Annotated[str, Field(min_length=1, max_length=500)]) -> str:
    """Ask one focused question about a missing career fact and wait for the user's answer."""
    if not ctx.deps.allow_question:
        return "Further questions are disabled. Propose faithful wording using only known facts."
    raise CallDeferred()


@library_edit_agent.output_validator
def validate_edit(ctx: RunContext[LibraryEditDeps], output: LibraryEditDraft | DeferredToolRequests):
    if isinstance(output, LibraryEditDraft) and (
        not output.text.strip() or not output.reason.strip() or len(output.text) > ctx.deps.text_limit
    ):
        raise ModelRetry(f"Provide nonblank replacement text within {ctx.deps.text_limit} characters and a short assessment reason.")
    return output


class LibraryEditRun(NamedTuple):
    output: LibraryEditDraft | DeferredToolRequests
    history: list[dict]
    usage: RunUsage
    model: str


def improve_library_entry(prompt, history, deferred_results, deps, settings) -> LibraryEditRun:
    """Run only prepared input under the normal task deadline and usage budgets."""
    async def execute():
        limits = agent_usage_limits(settings)
        limits.tool_calls_limit = settings.library_edit_tool_calls_limit
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            with record_prompt_version(LIBRARY_EDIT_PROMPT_VERSION):
                result = await library_edit_agent.run(
                    prompt, message_history=history, deferred_tool_results=deferred_results,
                    deps=deps, model=generative_model(settings.library_edit_model, settings.generative_fallback_model),
                    model_settings=ModelSettings(thinking=settings.library_edit_thinking, parallel_tool_calls=False),
                    usage_limits=limits,
                )
        return LibraryEditRun(result.output, json.loads(result.all_messages_json()), result.usage,
                              reported_model_name(result.response.model_name or settings.library_edit_model, settings.library_edit_model))
    return asyncio.run(execute())
