"""Compare a saved job with the user's screened career library without database writes.

Only saved requirements and nice-to-haves enter the job comparison and screening.
The required job and complete library must pass screening before generation.
Only the exact prompt rendered from approved sources can reuse those screening decisions
within this execution.
"""

from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel

from agents.gap_analysis_agent import analyze_gaps
from gap_analysis.attach_evidence_text import attach_evidence_text
from gap_analysis.prepare_gap_analysis import prepare_gap_analysis
from screening.job_inputs import job_source_values
from screening.library_inputs import library_source_values
from screening.saved_sources import register_saved_sources
from screening.session import within_screening_session
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage, AiTaskMessage
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
    if not (context.job.requirements or context.job.nice_to_haves):
        return _failed(task, NO_REQUIREMENTS_MESSAGE)

    settings = dependencies.settings
    model = settings.gap_analysis_model
    # Only this owner-scoped server read establishes saved-source provenance.
    register_saved_sources((*job_source_values(context.job), *library_source_values(context.career_library).sources))
    prepared = prepare_gap_analysis(
        context, today=datetime.now(UTC).date(),
        screen_model=settings.user_text_screen_model,
        timeout_seconds=settings.llm_run_timeout_seconds,
    )
    if prepared.error_message:
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed",
            error_message=prepared.error_message, usage=prepared.usage,
        )
    prompt = prepared.prompt
    assert prompt is not None
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
        usage=[build_model_usage(run.model or model, run.usage), *prepared.usage],
    )


def _failed(task: AiTaskMessage, error_message: str) -> AiResultMessage:
    """A failed result with a message the user sees."""
    return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=error_message)
