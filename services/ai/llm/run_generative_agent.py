"""Run one generative agent the same way every time.

Agents differ in prompts, output types and which model they use. The rest of a run is
identical: a deadline shared with earlier screening, a prompt-version span, the primary
model with its fallback, thinking settings and the request/token caps. This module owns
that sequence so agent files only name their own inputs.

It does not report usage. `llm/usage.py` observes every real model request while a task is
collecting costs, including requests whose output later failed validation. When the agent
cannot produce valid output after its retries, this raises `GenerativeOutputInvalid` and the
handler picks the user-facing message.
"""

import asyncio

from pydantic_ai import Agent
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits

from llm.generative_model import generative_model
from llm.run_limits import agent_usage_limits
from screening.session import remaining_timeout, screening_session
from settings import load_settings
from telemetry.tracing import record_prompt_version


class GenerativeOutputInvalid(Exception):
    """The model answered, but never with output the agent would accept."""


async def run_generative_agent_async(
    agent: Agent, prompt: str, *, model: str, fallback_model: str, thinking, timeout_seconds: float,
    prompt_version: str, usage_limits: UsageLimits | None = None,
    model_settings: dict | None = None, **run_arguments,
):
    """Runs the agent inside an existing event loop and returns Pydantic AI's run result.

    Raises TimeoutError past the shared deadline, UsageLimitExceeded at a run cap, and
    GenerativeOutputInvalid when the output is still invalid after the agent's own output
    retries (this function adds none). The message is raw provider detail: log it, never show it.
    A provider error tries `fallback_model`. `run_arguments` pass through to `agent.run`
    (deps, message history, output type, capabilities).
    """
    async with asyncio.timeout(remaining_timeout(timeout_seconds)):
        with record_prompt_version(prompt_version):
            try:
                return await agent.run(
                    prompt, model=generative_model(model, fallback_model),
                    model_settings=ModelSettings(thinking=thinking, **(model_settings or {})),
                    usage_limits=usage_limits or agent_usage_limits(load_settings()),
                    **run_arguments,
                )
            except UnexpectedModelBehavior as error:
                raise GenerativeOutputInvalid(str(error)) from error


def run_generative_agent(
    agent: Agent, prompt: str, *, model: str, fallback_model: str, thinking, timeout_seconds: float,
    prompt_version: str, usage_limits: UsageLimits | None = None,
    model_settings: dict | None = None, **run_arguments,
):
    """Synchronous entry point for worker handlers; see `run_generative_agent_async`.

    Joins the task's screening deadline when one is active, so earlier screening time counts.
    """
    with screening_session(timeout_seconds, reuse=True):
        return asyncio.run(run_generative_agent_async(
            agent, prompt, model=model, fallback_model=fallback_model, thinking=thinking,
            timeout_seconds=timeout_seconds, prompt_version=prompt_version,
            usage_limits=usage_limits, model_settings=model_settings, **run_arguments,
        ))
