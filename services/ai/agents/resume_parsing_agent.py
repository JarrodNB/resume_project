"""
Description: Pydantic AI agent that turns resume text into a ParsedResume.
Index:
    - resume_parsing_agent: the agent (model is chosen per run, see parse_resume_text)
    - parse_resume_text: runs the agent on extracted resume text
"""

from pydantic_ai import Agent

from prompts.resume_parsing_instructions import RESUME_PARSING_INSTRUCTIONS
from schemas.parsed_resume import ParsedResume

resume_parsing_agent = Agent(
    name="resume_parsing_agent",
    output_type=ParsedResume,
    instructions=RESUME_PARSING_INSTRUCTIONS,
    defer_model_check=True,
)


def parse_resume_text(resume_text: str, model: str) -> ParsedResume:
    """Extracts structured resume data from plain text using the given model name."""
    result = resume_parsing_agent.run_sync(resume_text, model=model)
    return result.output
