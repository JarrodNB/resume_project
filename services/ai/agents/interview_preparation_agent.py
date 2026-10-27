"""Build a fresh guarded agent that proposes a complete plan for atomic Rails acceptance."""
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.capabilities import Hooks
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from privacy.contact_mask import _mask_request, _unmask_response
from prompts.interview_preparation_instructions import (
    FICTIONAL_ROLE_PREPARATION_INSTRUCTIONS,
    INTERVIEW_PREPARATION_INSTRUCTIONS,
    SAVED_JOB_PREPARATION_INSTRUCTIONS,
)
from schemas.interview_preparation import InterviewPreparation, SavedJobInterviewPreparation
from schemas.interview_setup import InterviewSetup


def make_preparer(guard, *, system_prompt="", question_count=9, question_format="mixed", saved_job=False):
    """Use questions-only output for saved jobs; fictional practice generates a role too."""
    setup = InterviewSetup(question_count=question_count, question_format=question_format)
    expected_types = setup.question_types()
    role_instructions = SAVED_JOB_PREPARATION_INSTRUCTIONS if saved_job else FICTIONAL_ROLE_PREPARATION_INSTRUCTIONS
    agent = Agent(name="spoken_interview_preparation",
        output_type=SavedJobInterviewPreparation if saved_job else InterviewPreparation,
        instructions=(f"{INTERVIEW_PREPARATION_INSTRUCTIONS}\n{role_instructions}\nGenerate exactly {question_count} main questions. "
            f"The selected question format is {question_format}. Use these question types in this exact order: "
            + ", ".join(expected_types) + "."),
        system_prompt=system_prompt, defer_model_check=True, retries=1,
        capabilities=[ConversationLogging(), Hooks(before_model_request=_mask_request,
            after_model_request=_unmask_response), InputGuardrail(guard=guard)])

    @agent.output_validator
    def validate_saved_plan(output: InterviewPreparation):
        if [question.question_type for question in output.questions] != expected_types:
            raise ModelRetry(f"The saved interview requires exactly these ordered question types: {', '.join(expected_types)}.")
        return output

    return agent
