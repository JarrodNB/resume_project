"""Build a fresh guarded agent that proposes a complete plan for atomic Rails acceptance."""
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.capabilities import Hooks
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from prompts.interview_preparation_instructions import INTERVIEW_PREPARATION_INSTRUCTIONS
from schemas.interview_preparation import InterviewPreparation
from worker.contact_mask import _mask_request, _unmask_response


def make_preparer(guard, *, system_prompt="", question_count=9):
    agent = Agent(name="spoken_interview_preparation", output_type=InterviewPreparation,
        instructions=f"{INTERVIEW_PREPARATION_INSTRUCTIONS}\nGenerate exactly {question_count} main questions.",
        system_prompt=system_prompt, defer_model_check=True, retries=1,
        capabilities=[ConversationLogging(), Hooks(before_model_request=_mask_request,
            after_model_request=_unmask_response), InputGuardrail(guard=guard)])

    @agent.output_validator
    def validate_saved_length(output: InterviewPreparation):
        if len(output.questions) != question_count:
            raise ModelRetry(f"The saved interview requires exactly {question_count} questions.")
        return output

    return agent
