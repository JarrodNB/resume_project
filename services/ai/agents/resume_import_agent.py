"""Extract mixed career records behind the isolated importer, using official guardrails."""

from pydantic_ai import Agent
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from prompts.resume_import_instructions import RESUME_IMPORT_INSTRUCTIONS
from schemas.resume_import import ResumeImportExtraction
from screening.prompt_guardrail import screen_prompt

resume_import_agent = Agent(
    name="resume_import_agent",
    output_type=ResumeImportExtraction,
    instructions=RESUME_IMPORT_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)
