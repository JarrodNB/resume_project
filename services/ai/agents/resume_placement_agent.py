"""Resolve only source-backed ambiguous bullets after primary resume extraction."""

from pydantic_ai import Agent
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from prompts.resume_placement_instructions import RESUME_PLACEMENT_INSTRUCTIONS
from schemas.resume_placement import ResumePlacement
from screening.prompt_guardrail import screen_prompt

resume_placement_agent = Agent(
    name="resume_placement_agent",
    output_type=ResumePlacement,
    instructions=RESUME_PLACEMENT_INSTRUCTIONS,
    retries=0,
    defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)
