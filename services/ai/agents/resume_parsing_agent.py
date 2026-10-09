"""
Description: Pydantic AI agent that turns resume text into a ParsedResume.
Index:
    - resume_parsing_agent: the agent (model and reasoning effort are chosen per run)
    - ResumeParsingRun: the parsed resume, token usage, and the model name to bill
    - format_resume_user_prompt: fences extracted text so a tag inside the file cannot close it
    - parse_resume_text: runs the agent on extracted resume text within a time limit
"""

import asyncio
import re
from typing import NamedTuple

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai.usage import RunUsage

from prompts.resume_parsing_instructions import (
    RESUME_PARSING_INSTRUCTIONS,
    RESUME_PARSING_PROMPT_VERSION,
)
from schemas.parsed_resume import ParsedResume
from worker.generative_model import generative_model
from worker.model_prices import reported_model_name
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.tracing import record_prompt_version

# A resume can contain the fence tags, including a space or newline inside the tag.
# Replacing "<" keeps the words and stops the tag closing.
_RESUME_TAG = re.compile(r"<\s*/?\s*resume\s*>", re.IGNORECASE)


def format_resume_user_prompt(resume_text: str) -> str:
    """Wraps extracted resume text as data. A tag inside the file cannot close the fence."""
    neutralized = _RESUME_TAG.sub(lambda match: match.group(0).replace("<", "&lt;"), resume_text)
    return f"<resume>\n{neutralized}\n</resume>"


resume_parsing_agent = Agent(
    name="resume_parsing_agent",
    output_type=ParsedResume,
    instructions=RESUME_PARSING_INSTRUCTIONS,
    defer_model_check=True,
)


class ResumeParsingRun(NamedTuple):
    """The agent's output, the tokens it used, and the model name to bill."""

    parsed_resume: ParsedResume
    usage: RunUsage
    model: str = ""


def parse_resume_text(
    resume_text: str,
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> ResumeParsingRun:
    """Extracts structured resume data from plain text using the given model name and reasoning
    effort. Raises TimeoutError if the whole run (including the provider's own retries) takes
    longer than timeout_seconds. Raises UsageLimitExceeded when the run passes its request,
    tool-call, or token cap. A provider error tries fallback_model."""
    return asyncio.run(
        _run_with_deadline(resume_text, model, thinking, timeout_seconds, fallback_model)
    )


async def _run_with_deadline(
    resume_text: str,
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> ResumeParsingRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(timeout_seconds):
        with record_prompt_version(RESUME_PARSING_PROMPT_VERSION):
            result = await resume_parsing_agent.run(
                format_resume_user_prompt(resume_text),
                model=generative_model(model, fallback_model),
                model_settings=ModelSettings(thinking=thinking),
                usage_limits=agent_usage_limits(load_settings()),
            )
    return ResumeParsingRun(
        parsed_resume=result.output,
        usage=result.usage,
        model=reported_model_name(result.response.model_name or model, model),
    )
