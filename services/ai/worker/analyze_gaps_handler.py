"""Compare a saved job with the user's screened career library without database writes.

The required job must pass screening. Unsafe optional library entries are omitted before
labels and evidence maps are built. Only the exact prompt rendered from retained sources
can reuse those screening decisions within this execution.
"""

from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic_ai_harness import InputBlocked

import text_limits
from agents.gap_analysis_agent import analyze_gaps
from gap_analysis.attach_evidence_text import attach_evidence_text
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from schemas.gap_analysis_context import GapAnalysisContext, JobToAnalyze
from screening.library_inputs import rebuild_library, screen_library_inputs
from screening.prompt_guardrail import BLOCKED_MESSAGE, TOO_LONG_MESSAGE, UNCHECKED_MESSAGE
from screening.screen_user_text import ScreenOutcome, screen_user_text
from screening.session import bind_screened_prompt, within_screening_session
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage, AiTaskMessage, ModelUsage
from worker.task_dependencies import TaskDependencies

JOB_NOT_FOUND_MESSAGE = "This job no longer exists."
EMPTY_LIBRARY_MESSAGE = (
    "Your career library is empty. Import a resume first, then compare it with this job."
)
NO_REQUIREMENTS_MESSAGE = "This job has no requirements to compare with your career library."


class AnalyzeGapsInput(BaseModel):
    """Input of an analyze_gaps task."""

    job_id: UUID


@within_screening_session
def handle_analyze_gaps_task(
    task: AiTaskMessage, dependencies: TaskDependencies
) -> AiResultMessage:
    """Compares the job's requirements with the user's career library."""
    job_id = AnalyzeGapsInput.model_validate(task.input).job_id
    # Rails checked these when queuing, but the job or library may have changed since.
    context = dependencies.read_gap_analysis_context(task.user_id, job_id)
    if context is None:
        return _failed(task, JOB_NOT_FOUND_MESSAGE)
    if context.career_library.is_empty():
        return _failed(task, EMPTY_LIBRARY_MESSAGE)
    if not (context.job.requirements or context.job.responsibilities or context.job.nice_to_haves):
        return _failed(task, NO_REQUIREMENTS_MESSAGE)

    settings = dependencies.settings
    model = settings.gap_analysis_model
    screen_usage: list[ModelUsage] = []

    def allow_input(text: str) -> ScreenOutcome:
        """Screen a cohesive source and retain billed usage, including rejected inputs."""
        outcome = _screen_fact(
            text, settings.user_text_screen_model, settings.llm_run_timeout_seconds
        )
        if outcome.usage is not None and outcome.model is not None:
            screen_usage.append(build_model_usage(outcome.model, outcome.usage))
        return outcome

    job_source = context.job.model_dump_json(exclude_none=True)
    job_decision = allow_input(job_source)
    if not job_decision.allowed:
        message = TOO_LONG_MESSAGE if job_decision.too_long else (
            UNCHECKED_MESSAGE if job_decision.unchecked else BLOCKED_MESSAGE
        )
        raise InputBlocked(message)
    selected = screen_library_inputs(context.career_library, allow_input)
    today = datetime.now(UTC).date()
    layout = selected.fields
    prompt = None

    def render(values):
        nonlocal prompt
        screened_context = GapAnalysisContext(
            job=JobToAnalyze.model_validate_json(values[0]),
            career_library=rebuild_library(values[1:], layout),
        )
        prompt = build_gap_analysis_prompt(screened_context, today=today)
        return prompt.text

    bind_screened_prompt((job_source, *selected.sources), render)
    prompt.warnings.extend(selected.warnings)
    if text_limits.prompt_is_too_long(prompt.text):
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message=text_limits.GAP_PROMPT_TOO_LONG_MESSAGE,
            usage=screen_usage,
        )
    run = analyze_gaps(
        prompt,
        model=model,
        thinking=settings.gap_analysis_thinking,
        timeout_seconds=settings.llm_run_timeout_seconds,
        fallback_model=settings.generative_fallback_model,
    )
    result = attach_evidence_text(run.gap_analysis, prompt)
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"gap_analysis": result.model_dump(mode="json"), "warnings": prompt.warnings},
        usage=[build_model_usage(run.model or model, run.usage), *screen_usage],
    )


def _screen_fact(text: str, model: str, timeout_seconds: float) -> ScreenOutcome:
    """Screen one source. Kept as the handler's replaceable classifier seam."""
    return screen_user_text(text, model=model, timeout_seconds=timeout_seconds)


def _failed(task: AiTaskMessage, error_message: str) -> AiResultMessage:
    """A failed result with a message the user sees."""
    return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=error_message)
