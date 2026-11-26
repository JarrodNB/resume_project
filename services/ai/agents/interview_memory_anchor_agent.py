"""Generate a short cue per answer sentence with exact source coverage checks."""
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.run_generative_agent import run_generative_agent
from privacy.contact_mask import mask_outbound
from prompts.interview_memory_anchor_instructions import (
    INTERVIEW_MEMORY_ANCHOR_INSTRUCTIONS,
    INTERVIEW_MEMORY_ANCHOR_PROMPT_VERSION,
)
from schemas.interview_memory_anchor import InterviewMemoryAnchor
from screening.prompt_guardrail import screen_prompt

interview_memory_anchor_agent = Agent(
    name="interview_memory_anchor_agent", deps_type=str, output_type=InterviewMemoryAnchor,
    instructions=INTERVIEW_MEMORY_ANCHOR_INSTRUCTIONS, retries=2, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)


@interview_memory_anchor_agent.output_validator
def validate_anchor(context: RunContext[str], anchor: InterviewMemoryAnchor) -> InterviewMemoryAnchor:
    """Reject skipped/reordered source text and unusable or overlong cues."""
    # Contact masking ignores case, so a restored email or name can differ from the answer only in
    # capitals. Compare with the known contact masked on both sides.
    returned = mask_outbound(" ".join(" ".join(cue.sentence for cue in anchor.cues).split()))
    if returned != mask_outbound(" ".join(context.deps.split())):
        raise ModelRetry("Copy every complete sentence exactly once, in original order, including labels.")
    if any(not cue.cue.strip() or "→" in cue.cue for cue in anchor.cues) or len(anchor.text) > 600:
        raise ModelRetry("Use nonblank cues without arrows inside them; the joined anchor must fit 600 characters.")
    return anchor


def generate_interview_memory_anchor(text: str, answer: str, settings) -> InterviewMemoryAnchor:
    """Use the written-practice model with shared deadlines, fallback and accounting."""
    return run_generative_agent(
        interview_memory_anchor_agent, text, deps=answer, model=settings.interview_feedback_model,
        thinking=settings.interview_feedback_thinking, fallback_model=settings.generative_fallback_model,
        timeout_seconds=settings.llm_run_timeout_seconds, prompt_version=INTERVIEW_MEMORY_ANCHOR_PROMPT_VERSION,
    ).output
