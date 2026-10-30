"""Turn one queued tailoring request into a complete, unsaved resume draft.

The tailoring module owns evidence and generation. This adapter returns only a completed
result or an expected input failure; unexpected errors retain the worker's retry policy.
"""

import asyncio
from dataclasses import replace

from schemas.model_usage import ModelUsage
from tailoring.generate_resume_draft import ResumeDraftInputError, generate_resume_draft
from tailoring.tailor_resume_input import TailorResumeInput
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies

JOB_NOT_FOUND_MESSAGE = "This job or selected comparison no longer exists."


def handle_tailor_resume_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """Generate a complete draft without approval pauses or writes to domain data."""
    data = TailorResumeInput.model_validate(task.input)
    reader = dependencies.read_tailoring_sources
    if reader is None:
        raise RuntimeError("Tailoring source reader is not configured")
    sources = reader(task.ai_task_id, task.user_id, data.job_id, data.analysis_task_id)
    if sources is None:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
                               error_message=JOB_NOT_FOUND_MESSAGE)
    dependencies = replace(dependencies, read_gap_analysis_context=lambda *_: sources.context)
    usage: list[ModelUsage] = []
    try:
        draft = asyncio.run(generate_resume_draft(task.user_id, data, dependencies, sources=sources, usage=usage))
    except ResumeDraftInputError as error:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=str(error),
            usage=usage)
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed",
        result={"sections": draft.sections, "warnings": draft.warnings}, usage=usage)
