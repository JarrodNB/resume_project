"""Extract copied job fields from one scraped ad without injection classification.

This narrow parser has no tools, private user context or message history. Input
and execution limits plus source validators still apply. Its output remains
untrusted job data and earns no screening approval for later workflows.
Pasted ads and other agents retain their existing screening policy.
"""

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelRequest, ModelResponse, ToolReturnPart, UserPromptPart
from pydantic_ai.settings import ThinkingLevel
from pydantic_ai_harness import InputBlocked, InputGuardrail

from agents.parse_job_posting_agent import (
    JobPostingParseRun,
    check_copied_from_ad,
    fence_job_ad,
    run_job_ad_parser,
)
from conversation_logging import ConversationLogging
from privacy.contact_mask import mask_outbound
from prompts.parse_job_posting_instructions import PARSE_JOB_POSTING_INSTRUCTIONS
from schemas.parsed_job_posting import ParsedJobPosting
from screening.session import within_screening_session
from text_limits import JOB_AD_TOO_LONG_MESSAGE, MAX_PROMPT_TEXT, MAX_SCREENED_TEXT


async def check_scraped_ad_input(context: RunContext[str], prompt: str) -> bool:
    """Enforce one bounded source and no prior history, without a classifier call."""
    text = context.deps
    if not isinstance(text, str) or not text.strip():
        raise InputBlocked("The scraped advertisement is empty.")
    if len(text) > MAX_SCREENED_TEXT or len(prompt) > MAX_PROMPT_TEXT:
        raise InputBlocked(JOB_AD_TOO_LONG_MESSAGE)
    if mask_outbound(prompt) != mask_outbound(fence_job_ad(text)):
        raise InputBlocked("Only the selected scraped advertisement may be parsed.")
    if len(context.messages) != 1 or not isinstance(context.messages[0], ModelRequest):
        raise InputBlocked("Scraped ad parsing does not accept conversation history.")
    user_parts = []
    for message in context.messages:
        if isinstance(message, ModelResponse):
            raise InputBlocked("Scraped ad parsing does not accept conversation history.")
        if isinstance(message, ModelRequest):
            if any(isinstance(part, ToolReturnPart) for part in message.parts):
                raise InputBlocked("Scraped ad parsing does not accept tool results.")
            user_parts.extend(part for part in message.parts if isinstance(part, UserPromptPart))
    if len(user_parts) != 1 or user_parts[0].content != prompt:
        raise InputBlocked("Scraped ad parsing accepts one source message only.")
    return True


parse_scraped_job_posting_agent = Agent(
    name="parse_scraped_job_posting_agent", deps_type=str,
    output_type=ParsedJobPosting, instructions=PARSE_JOB_POSTING_INSTRUCTIONS,
    retries=2, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=check_scraped_ad_input)],
)
parse_scraped_job_posting_agent.output_validator(check_copied_from_ad)


@within_screening_session
def parse_scraped_job_posting(
    text: str, model: str, thinking: ThinkingLevel, timeout_seconds: float, fallback_model: str,
) -> JobPostingParseRun:
    """Run the source-only parser with the normal deadline, usage limits and tracing."""
    return run_job_ad_parser(
        parse_scraped_job_posting_agent, text, model, thinking, timeout_seconds, fallback_model,
    )
