"""Build a tool-free career-chat agent with exact newest-message guard coverage."""
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.capabilities import Hooks
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from privacy.contact_mask import _mask_request
from prompts.chat_instructions import CHAT_INSTRUCTIONS


def make_chat_agent(guard):
    agent = Agent(name="career_chat", output_type=str, instructions=CHAT_INSTRUCTIONS,
                  defer_model_check=True, retries=1,
                  capabilities=[ConversationLogging(), Hooks(before_model_request=_mask_request),
                                InputGuardrail(guard=guard)])

    @agent.output_validator
    def bounded_reply(output: str):
        if not output.strip() or len(output) > 8000:
            raise ModelRetry("Reply must contain between 1 and 8,000 characters.")
        return output

    return agent
