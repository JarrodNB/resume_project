"""Build the spoken interviewer with structured output and the shared input guard.

One model request returns the whole reply, including the decision to continue or advance.
An advance decision only expresses intent; Rails decides and saves progression atomically.
The caller supplies a durably accounted model; this agent never substitutes models.
"""

from pydantic_ai import Agent
from pydantic_ai.capabilities import Hooks
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from privacy.contact_mask import _mask_request, _unmask_response
from prompts.spoken_interviewer_instructions import SPOKEN_INTERVIEW_INSTRUCTIONS
from schemas.spoken_interview import SpokenInterviewReply


def make_interviewer(guard, *, system_prompt=""):
    """Build a fresh single-run agent; progression intent never carries into another turn."""
    return Agent(name="spoken_interviewer", output_type=SpokenInterviewReply,
                  instructions=SPOKEN_INTERVIEW_INSTRUCTIONS, system_prompt=system_prompt, defer_model_check=True, retries=1,
                  capabilities=[ConversationLogging(),
                                Hooks(before_model_request=_mask_request, after_model_request=_unmask_response),
                                InputGuardrail(guard=guard)])
