"""Generate bounded coaching for the exact answered questions in a completed interview.

The claim is trusted context for identity validation; the prompt contains only readable
saved text. Shared guardrails, privacy hooks and provider accounting remain active.
"""
import asyncio

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ModelSettings
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.generative_model import generative_model
from llm.run_limits import agent_usage_limits
from prompts.interview_session_feedback_instructions import (
    INTERVIEW_SESSION_FEEDBACK_INSTRUCTIONS,
    INTERVIEW_SESSION_FEEDBACK_PROMPT_VERSION,
)
from schemas.interview_session_feedback import FeedbackClaim, InterviewSessionFeedback
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout
from telemetry.tracing import record_prompt_version

interview_session_feedback_agent = Agent(name="interview_session_feedback_agent", deps_type=FeedbackClaim,
    output_type=InterviewSessionFeedback, instructions=INTERVIEW_SESSION_FEEDBACK_INSTRUCTIONS,
    retries=2, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)])


@interview_session_feedback_agent.output_validator
async def validate_question_coverage(context: RunContext[FeedbackClaim], output: InterviewSessionFeedback):
    expected = {question.question_id for question in context.deps.questions}
    actual = [question.question_id for question in output.questions]
    if len(actual) != len(expected) or set(actual) != expected:
        raise ModelRetry("Return each supplied core question ID exactly once; no omitted, duplicate or invented IDs.")
    if len(output.model_dump_json().encode("utf-8")) > 120_000:
        raise ModelRetry("Keep the entire feedback concise, below 120000 UTF-8 bytes including all questions.")
    if not output.summary.strip() or any(not question.example_answer.strip() for question in output.questions):
        raise ModelRetry("Use nonblank summary and example answers.")
    return output


def generate_interview_session_feedback(prompt, claim, settings):
    """Use existing interview feedback model settings and the task's shared deadline."""
    async def run():
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            with record_prompt_version(INTERVIEW_SESSION_FEEDBACK_PROMPT_VERSION):
                return await interview_session_feedback_agent.run(prompt, deps=claim,
                    model=generative_model(settings.interview_feedback_model, settings.generative_fallback_model),
                    model_settings=ModelSettings(thinking=settings.interview_feedback_thinking),
                    usage_limits=agent_usage_limits(settings))
    return asyncio.run(run())
