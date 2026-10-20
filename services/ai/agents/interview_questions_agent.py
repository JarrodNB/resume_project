"""
Description: Generates scope-specific distinct questions with excerpt and category-label checks.
Index:
    - interview_questions_agent / check_labels: agent and output validation
    - InterviewQuestionsRun / generate_interview_questions: bounded run and billed usage
"""
import asyncio
import re
from typing import NamedTuple

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputGuardrail

from prompts.interview_question_instructions import (
    INTERVIEW_QUESTIONS_INSTRUCTIONS,
    INTERVIEW_QUESTIONS_PROMPT_VERSION,
)
from schemas.interview_questions import (
    QUESTION_CATEGORIES,
    InterviewQuestionContext,
    InterviewQuestions,
    normalize_question,
)
from screening.prompt_guardrail import screen_prompt
from screening.session import remaining_timeout, within_screening_session
from worker.generative_model import generative_model
from worker.model_prices import reported_model_name
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.tracing import record_prompt_version

interview_questions_agent = Agent(
    name="interview_questions_agent",
    deps_type=InterviewQuestionContext,
    output_type=InterviewQuestions,
    instructions=INTERVIEW_QUESTIONS_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[InputGuardrail(guard=screen_prompt)],
)


@interview_questions_agent.output_validator
def check_labels(context: RunContext[InterviewQuestionContext], analysis: InterviewQuestions) -> InterviewQuestions:
    """Retries incorrect scope/count, exposed category labels, duplicates, or unsupported excerpts."""
    problems = []
    categories = QUESTION_CATEGORIES[context.deps.set_type]
    if any(q.category not in categories for q in analysis.questions):
        problems.append(f"Use only {context.deps.set_type} categories: {', '.join(categories)}.")
    if len(analysis.questions) != context.deps.count:
        problems.append(f"Return exactly {context.deps.count} questions.")
    if context.deps.set_type == "general" and context.deps.count == 1 and any(
        question.category == "introduction" for question in analysis.questions
    ):
        problems.append("A general replacement must use a behavioral category, not introduction or role motivation.")
    if context.deps.count == 5 and len({q.category for q in analysis.questions}) != 5:
        problems.append("Use each of the five interview categories once.")
    seen = {normalize_question(text) for text in context.deps.excluded}
    for question in analysis.questions:
        category_prefix = question.category.replace("_", r"[ _]")
        if re.match(rf"\s*{category_prefix}\s*:", question.question_text, re.IGNORECASE):
            problems.append("Keep category labels in metadata only; start question_text directly with the question.")
        key = normalize_question(question.question_text)
        if key in seen:
            problems.append("Questions must be distinct from one another and excluded questions.")
        seen.add(key)
        if any(not quote.strip() or quote not in context.deps.library_text for quote in question.evidence_quotes):
            problems.append("Evidence quotes must be exact nonblank excerpts of the library.")
    if problems:
        raise ModelRetry("Fix these problems and answer again:\n- " + "\n- ".join(problems))
    return analysis


class InterviewQuestionsRun(NamedTuple):
    """What one agent run produced."""

    questions: InterviewQuestions
    usage: RunUsage
    model: str = ""


@within_screening_session
def generate_interview_questions(
    prompt: InterviewQuestionContext,
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> InterviewQuestionsRun:
    """Runs the agent on a built prompt. Raises TimeoutError if the whole run takes longer than
    timeout_seconds. Raises UsageLimitExceeded when the run passes its request, tool-call, or
    token cap. A provider error tries fallback_model."""
    return asyncio.run(_run_with_deadline(prompt, model, thinking, timeout_seconds, fallback_model))


async def _run_with_deadline(
    prompt: InterviewQuestionContext,
    model: str,
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> InterviewQuestionsRun:
    """Runs the agent, cancelling it once timeout_seconds have passed."""
    async with asyncio.timeout(remaining_timeout(timeout_seconds)):
        with record_prompt_version(INTERVIEW_QUESTIONS_PROMPT_VERSION):
            result = await interview_questions_agent.run(
                prompt.text,
                deps=prompt,
                model=generative_model(model, fallback_model),
                model_settings=ModelSettings(thinking=thinking),
                usage_limits=agent_usage_limits(load_settings()),
            )
    return InterviewQuestionsRun(
        questions=result.output,
        usage=result.usage,
        model=reported_model_name(result.response.model_name or model, model),
    )
