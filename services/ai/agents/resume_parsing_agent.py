"""
Description: Pydantic AI agent that turns resume text into a ParsedResume.
Index:
    - resume_parsing_agent: the agent (model and reasoning effort are chosen per run)
    - ResumeParsingRun: the parsed resume plus the run's token usage
    - parse_resume_text: runs the agent on extracted resume text within a time limit
"""

import asyncio
from typing import NamedTuple

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai.usage import RunUsage

from prompts.resume_parsing_instructions import RESUME_PARSING_INSTRUCTIONS
from schemas.parsed_resume import ParsedResume

resume_parsing_agent = Agent(
    name="resume_parsing_agent",
    output_type=ParsedResume,
    instructions=RESUME_PARSING_INSTRUCTIONS,
    defer_model_check=True,
)


class ResumeParsingRun(NamedTuple):
    """The agent's output and the tokens it used."""

    parsed_resume: ParsedResume
    usage: RunUsage


def parse_resume_text(
    resume_text: str, model: str, thinking: ThinkingEffort, timeout_seconds: float
) -> ResumeParsingRun:
    """Extracts structured resume data from plain text using the given model name and reasoning
    effort. Raises TimeoutError if the whole run (including the provider's own retries) takes
    longer than timeout_seconds."""
    return asyncio.run(_run_with_deadline(resume_text, model, thinking, timeout_seconds))


async def _run_with_deadline(
    resume_text: str, model: str, thinking: ThinkingEffort, timeout_seconds: float
) -> ResumeParsingRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(timeout_seconds):
        result = await resume_parsing_agent.run(
            resume_text, model=model, model_settings=ModelSettings(thinking=thinking)
        )
    return ResumeParsingRun(parsed_resume=result.output, usage=result.usage)
