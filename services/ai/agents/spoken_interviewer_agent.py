"""Build the spoken interviewer with structured output and the shared input guard.

The advance tool only expresses intent. Rails decides and saves progression atomically.
The caller supplies a durably accounted model; this agent never substitutes models.
"""

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.capabilities import Hooks
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from privacy.contact_mask import _mask_request, _unmask_response
from prompts.spoken_interviewer_instructions import SPOKEN_INTERVIEW_INSTRUCTIONS
from schemas.spoken_interview import SpokenInterviewReply


def make_interviewer(guard, *, system_prompt=""):
    """Build a fresh single-run agent; progression intent never carries into another turn."""
    agent = Agent(name="spoken_interviewer", output_type=SpokenInterviewReply,
                  instructions=SPOKEN_INTERVIEW_INSTRUCTIONS, system_prompt=system_prompt, defer_model_check=True, retries=1,
                  capabilities=[ConversationLogging(),
                                Hooks(before_model_request=_mask_request, after_model_request=_unmask_response),
                                InputGuardrail(guard=guard)])

    advanced = False

    @agent.tool_plain
    def advance_to_next_question() -> str:
        """Request advancement; Rails applies the saved question and answer-limit policy."""
        nonlocal advanced
        advanced = True
        return "Advancement requested. Rails decides the next question or closing."

    @agent.output_validator
    def require_advance_tool(ctx: RunContext, output: SpokenInterviewReply):
        if output.decision == "advance" and not advanced:
            raise ModelRetry("Call advance_to_next_question before requesting advance.")
        return output

    return agent
