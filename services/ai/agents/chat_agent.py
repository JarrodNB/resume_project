"""Build the career-chat agent with exact newest-message guard coverage.

Callers pass the run's tools as toolsets already scoped to the conversation owner.
The guard checks only the newest message; tools must return screened text themselves.
"""
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.capabilities import Hooks
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from privacy.contact_mask import _mask_request
from prompts.chat_instructions import CHAT_INSTRUCTIONS


def make_chat_agent(guard, toolsets=()):
    agent = Agent(name="career_chat", output_type=str, instructions=CHAT_INSTRUCTIONS,
                  defer_model_check=True, retries=1, toolsets=list(toolsets),
                  capabilities=[ConversationLogging(), Hooks(before_model_request=_mask_request),
                                InputGuardrail(guard=guard)])

    @agent.output_validator
    def bounded_reply(output: str):
        if not output.strip() or len(output) > 8000:
            raise ModelRetry("Reply must contain between 1 and 8,000 characters.")
        return output

    return agent
