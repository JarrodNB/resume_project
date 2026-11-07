"""
Description: Selects scope-specific coaching with nonblank checks and normalized evidence.
Index:
    - interview_feedback_agent / check_labels: agent and output validation
    - InterviewFeedbackRun / generate_interview_feedback: bounded run and billed usage
    - source_excerpt: removes presentation quotes only when the contents match source text
    - interview_feedback_instructions: selects trusted scope policy and general-only STAR guidance
"""
import re

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ThinkingLevel
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.run_generative_agent import run_generative_agent
from prompts.interview_feedback_instructions import (
    GENERAL_BEHAVIORAL_COACHING_INSTRUCTIONS,
    INTERVIEW_FEEDBACK_INSTRUCTIONS,
    INTERVIEW_FEEDBACK_PROMPT_VERSION,
)
from prompts.interview_knowledge_feedback_instructions import (
    INTERVIEW_KNOWLEDGE_FEEDBACK_INSTRUCTIONS,
)
from schemas.interview_feedback import (
    InterviewFeedback,
    InterviewFeedbackContext,
)
from screening.prompt_guardrail import screen_prompt

interview_feedback_agent = Agent(
    name="interview_feedback_agent",
    deps_type=InterviewFeedbackContext,
    output_type=InterviewFeedback,
    retries=2,
    defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)


@interview_feedback_agent.instructions
def interview_feedback_instructions(context: RunContext[InterviewFeedbackContext]) -> str:
    """Adds STAR guidance only to general coaching; keeps other scope policies separate."""
    if context.deps is not None and context.deps.set_type == "knowledge":
        return INTERVIEW_KNOWLEDGE_FEEDBACK_INSTRUCTIONS
    if context.deps is not None and context.deps.set_type == "general":
        return INTERVIEW_FEEDBACK_INSTRUCTIONS + GENERAL_BEHAVIORAL_COACHING_INSTRUCTIONS
    return INTERVIEW_FEEDBACK_INSTRUCTIONS


@interview_feedback_agent.output_validator
def check_labels(context: RunContext[InterviewFeedbackContext], analysis: InterviewFeedback) -> InterviewFeedback:
    """Retries blank coaching or too many placeholders; filters invalid optional evidence."""
    if any(not text.strip() for text in [*analysis.strengths, *analysis.improvements, analysis.example_answer]):
        raise ModelRetry("Use nonblank strengths, improvements, and an illustrative example answer.")
    if len(re.findall(r"\[[^\[\]]*\]", analysis.example_answer)) > 2:
        raise ModelRetry("Use at most two focused square-bracket placeholders. Omit optional missing details.")
    if context.deps.set_type == "knowledge" and len(analysis.example_answer.split()) > 120:
        raise ModelRetry("Keep the corrected knowledge example to at most 120 words while answering every question part.")
    excerpts = [source_excerpt(quote, context.deps.source_text) for quote in analysis.evidence_quotes]
    # Evidence is auxiliary metadata, so discard invalid excerpts without retrying prose.
    analysis.evidence_quotes = [quote for quote in excerpts if quote is not None]
    return analysis



def source_excerpt(quote: str, source: str) -> str | None:
    """Accepts exact text with optional whitespace or balanced presentation quotes."""
    if not quote.strip():
        return None
    if quote in source:
        return quote
    candidate = quote.strip()
    if candidate in source:
        return candidate
    pairs = {'"': '"', "'": "'", '“': '”', '‘': '’'}
    while len(candidate) >= 2 and pairs.get(candidate[0]) == candidate[-1]:
        candidate = candidate[1:-1].strip()
        if candidate and candidate in source:
            return candidate
    return None


def generate_interview_feedback(
    prompt: InterviewFeedbackContext,
    model: str,
    thinking: ThinkingLevel,
    timeout_seconds: float,
    fallback_model: str,
) -> InterviewFeedback:
    """Runs the agent on a built prompt. Raises TimeoutError if the whole run takes longer than
    timeout_seconds. Raises UsageLimitExceeded when the run passes its request, tool-call, or
    token cap. A provider error tries fallback_model."""
    return run_generative_agent(
        interview_feedback_agent, prompt.text, deps=prompt, model=model, fallback_model=fallback_model,
        thinking=thinking, timeout_seconds=timeout_seconds, prompt_version=INTERVIEW_FEEDBACK_PROMPT_VERSION,
    ).output
