"""
Description: Handles tailor_resume tasks. Contact is copied from the profile. Each later
section is one agent run, then the task pauses for approval. The same task is requeued;
the result echoes its generation so an older redelivery cannot rewind. Safe to run twice
(it only reads, and Rails ignores a stale generation).
Index:
    - JOB_NOT_FOUND_MESSAGE / SECTION_BLOCKED_MESSAGE: user-facing messages
    - handle_tailor_resume_task: one step of the loop (screen, write, or finish)
"""

from agents.resume_tailoring_agent import write_resume_section
from schemas.gap_analysis_context import GapAnalysisContext
from tailoring.build_section_prompt import build_section_prompt
from tailoring.materialize_section import materialize_section
from tailoring.retrieve_for_section import retrieve_source_keys
from tailoring.section_catalog import next_section
from tailoring.tailor_resume_input import ApprovedSection, TailorResumeInput
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage, AiTaskMessage, ModelUsage
from worker.tailor_resume_steps import (
    apply_pending,
    contact_content,
    failed_result,
    pause_for_section,
    screened_gap_responses,
)
from worker.task_dependencies import TaskDependencies

JOB_NOT_FOUND_MESSAGE = "This job no longer exists."
SECTION_BLOCKED_MESSAGE = "That edit can't be used. Change it and try again."


def handle_tailor_resume_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """Runs the next step of tailoring for this generation of the task."""
    data = TailorResumeInput.model_validate(task.input)
    context = dependencies.read_gap_analysis_context(task.user_id, data.job_id)
    if context is None:
        return failed_result(task, JOB_NOT_FOUND_MESSAGE)
    usage: list[ModelUsage] = []
    warnings: list[str] = []
    approved, blocked_content = apply_pending(data, dependencies, usage)
    if blocked_content is not None:
        return pause_for_section(
            task, data, approved, blocked_content, usage, warnings,
            blocked=True, message=SECTION_BLOCKED_MESSAGE,
        )
    return _write_or_finish(task, data, context, approved, usage, warnings, dependencies)


def _write_or_finish(
    task: AiTaskMessage,
    data: TailorResumeInput,
    context: GapAnalysisContext,
    approved: list[ApprovedSection],
    usage: list[ModelUsage],
    warnings: list[str],
    dependencies: TaskDependencies,
) -> AiResultMessage:
    """Copies contact, writes the next section, or completes the draft."""
    section_type = next_section([section.section_type for section in approved])
    if section_type is None:
        kept = [section.model_dump(mode="json") for section in approved if not section.omitted]
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="completed",
            result={"sections": kept, "warnings": warnings},
            generation=data.generation,
            usage=usage,
        )
    if section_type == "contact":
        return pause_for_section(task, data, approved, contact_content(data.contact), usage, warnings)
    responses = screened_gap_responses(data.gap_responses, dependencies, usage, warnings)
    retrieved, embedding_usage = retrieve_source_keys(
        task.user_id, section_type, context.job, dependencies.settings
    )
    if embedding_usage is not None:
        usage.append(embedding_usage)
    force = data.pending_section is not None and data.pending_section.action == "write_anyway"
    prompt = build_section_prompt(
        section_type,
        context,
        responses,
        [section.model_dump(mode="json") for section in approved],
        retrieved,
        write_anyway=force and data.pending_section.section_type == section_type,
        gap_analysis=data.gap_analysis,
    )
    settings = dependencies.settings
    run = write_resume_section(
        prompt,
        model=settings.resume_tailoring_model,
        thinking=settings.resume_tailoring_thinking,
        timeout_seconds=settings.llm_run_timeout_seconds,
    )
    usage.append(build_model_usage(settings.resume_tailoring_model, run.usage))
    content = materialize_section(section_type, run.draft, context.career_library, prompt.sources)
    return pause_for_section(
        task, data, approved, content, usage, warnings,
        section_type=section_type, nothing_fits=run.draft.nothing_fits,
    )
