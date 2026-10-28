"""Supply deterministic fixture text and an offline Pydantic interviewer.

These adapters never infer anything from the recording and cannot resolve a real model.
The advance tool expresses intent only; Rails still chooses the accepted response.
"""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.capabilities import Hooks
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai_harness import InputGuardrail

from privacy.contact_mask import _mask_request, _unmask_response

TRANSCRIPT = "I helped my team build a scheduling tool and checked the result with our users."
FOLLOW_UP = "What changed for the team after you introduced the tool?"
SPEECH_TEXTS = (
    "Tell me about a time you helped a team solve a difficult problem.",
    "How did you decide what to work on first?",
    FOLLOW_UP,
    "Thank you. This interview is complete.",
)
SCENARIOS = {"normal", "early-advance", "continue-at-cap", "blocked", "unavailable", "oversized"}


class InterviewReply(BaseModel):
    decision: Literal["continue", "advance"]
    reply: str | None = None


def make_agent(scenario: str, guard, provider_call):
    """Build a local agent with a real tool exchange and official input guardrail."""
    if scenario not in SCENARIOS:
        raise ValueError("Unknown fake scenario")

    async def respond(messages, info):
        return await provider_call(lambda: respond_locally(messages, info))

    def respond_locally(messages, info):
        returned = any(isinstance(part, ToolReturnPart) and part.tool_name == "advance_to_next_question"
                       for part in messages[-1].parts)
        if scenario == "early-advance" and not returned:
            return ModelResponse(parts=[ToolCallPart("advance_to_next_question", {}, tool_call_id="advance-fixture")])
        output = {"decision": "advance" if scenario == "early-advance" else "continue",
                  "reply": None if scenario == "early-advance" else FOLLOW_UP}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)])

    agent = Agent(FunctionModel(respond), output_type=InterviewReply, retries=0,
                  capabilities=[Hooks(before_model_request=_mask_request, after_model_request=_unmask_response),
                                InputGuardrail(guard=guard)])

    @agent.tool_plain
    def advance_to_next_question() -> str:
        """Request advancement; the durable Rails owner decides whether to advance."""
        return "Advancement requested. Rails will apply the saved interview policy."

    return agent


def speech_bytes(text: str) -> bytes:
    """Read only speech recorded for this exact accepted fixture message."""
    try:
        index = SPEECH_TEXTS.index(text)
    except ValueError:
        raise ValueError("No synthetic speech fixture matches saved text") from None
    return (Path(__file__).parent / "fixtures" / f"speech-{index}.wav").read_bytes()
