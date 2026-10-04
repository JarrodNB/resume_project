"""
Description: Handles analyze_gaps tasks: reads the job and the user's career library from the
database (read-only, scoped to the task's user), runs the gap analysis agent, and swaps its
evidence labels for library text. Safe to run twice (it only reads).
Index:
    - AnalyzeGapsInput: the task's `input`, sent by Rails
    - JOB_NOT_FOUND_MESSAGE / EMPTY_LIBRARY_MESSAGE / NO_REQUIREMENTS_MESSAGE: user-facing
      failure messages
    - handle_analyze_gaps_task: returns a completed result with the GapAnalysisResult and the
      agent's usage, or a failed result when there is nothing to compare
"""

from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel

from agents.gap_analysis_agent import analyze_gaps
from gap_analysis.attach_evidence_text import attach_evidence_text
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
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
    prompt = build_gap_analysis_prompt(context, today=datetime.now(UTC).date())
    run = analyze_gaps(
        prompt,
        model=model,
        thinking=settings.gap_analysis_thinking,
        timeout_seconds=settings.llm_run_timeout_seconds,
    )
    result = attach_evidence_text(run.gap_analysis, prompt)
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"gap_analysis": result.model_dump(mode="json")},
        usage=[build_model_usage(model, run.usage)],
    )


def _failed(task: AiTaskMessage, error_message: str) -> AiResultMessage:
    """A failed result with a message the user sees."""
    return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=error_message)
