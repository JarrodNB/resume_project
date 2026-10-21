"""Build a fresh guarded agent that proposes a complete plan for atomic Rails acceptance."""
from pydantic_ai import Agent
from pydantic_ai.capabilities import Hooks
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from prompts.interview_preparation_instructions import INTERVIEW_PREPARATION_INSTRUCTIONS
from schemas.interview_preparation import InterviewPreparation
from worker.contact_mask import _mask_request, _unmask_response


def make_preparer(guard):
    return Agent(name="spoken_interview_preparation", output_type=InterviewPreparation,
        instructions=INTERVIEW_PREPARATION_INSTRUCTIONS, defer_model_check=True, retries=1,
        capabilities=[ConversationLogging(), Hooks(before_model_request=_mask_request,
            after_model_request=_unmask_response), InputGuardrail(guard=guard)])
