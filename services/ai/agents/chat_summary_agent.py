"""Build bounded rolling memory from authenticated accepted chat sources.

The caller binds this exact rendered prompt to server-owned provenance, so generated
summaries and previously screened history never receive another Jev pass.
"""
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.capabilities import Hooks
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from privacy.contact_mask import _mask_request
from prompts.chat_summary_instructions import CHAT_SUMMARY_INSTRUCTIONS


def make_chat_summary_agent(guard):
    agent = Agent(name="career_chat_summary", output_type=str,
                  instructions=CHAT_SUMMARY_INSTRUCTIONS, defer_model_check=True, retries=1,
                  capabilities=[ConversationLogging(), Hooks(before_model_request=_mask_request),
                                InputGuardrail(guard=guard)])

    @agent.output_validator
    def bounded_summary(output: str):
        if not output.strip() or len(output) > 8000:
            raise ModelRetry("Summary must contain between 1 and 8,000 characters.")
        return output

    return agent
