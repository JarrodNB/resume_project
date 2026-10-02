"""
Description: Pydantic AI agent that turns resume text into a ParsedResume.
Index:
    - resume_parsing_agent: the agent (model is chosen per run, see parse_resume_text)
    - ResumeParsingRun: the parsed resume plus the run's token usage
    - parse_resume_text: runs the agent on extracted resume text
"""

from typing import NamedTuple

from pydantic_ai import Agent
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


def parse_resume_text(resume_text: str, model: str) -> ResumeParsingRun:
    """Extracts structured resume data from plain text using the given model name."""
    result = resume_parsing_agent.run_sync(resume_text, model=model)
    return ResumeParsingRun(parsed_resume=result.output, usage=result.usage)
