"""
Description: Dispatches a task message to the handler for its task_type.
Index:
    - TASK_HANDLERS: task_type -> handler function
    - handle_ai_task: runs one task and returns its result
"""

from collections.abc import Callable

from worker.analyze_gaps_handler import handle_analyze_gaps_task
from worker.parse_job_posting_handler import handle_parse_job_posting_task
from worker.parse_resume_handler import handle_parse_resume_task
from worker.queue_messages import AiResultMessage, AiTaskMessage, TaskType
from worker.scrape_job_handler import handle_scrape_job_task
from worker.tailor_resume_handler import handle_tailor_resume_task
from worker.task_dependencies import TaskDependencies

TaskHandler = Callable[[AiTaskMessage, TaskDependencies], AiResultMessage]

TASK_HANDLERS: dict[TaskType, TaskHandler] = {
    "parse_resume": handle_parse_resume_task,
    "scrape_job": handle_scrape_job_task,
    "parse_job_posting": handle_parse_job_posting_task,
    "analyze_gaps": handle_analyze_gaps_task,
    "tailor_resume": handle_tailor_resume_task,
}


def handle_ai_task(task: AiTaskMessage, dependencies: TaskDependencies) -> AiResultMessage:
    """Runs one task. Handlers must be safe to run twice, because SQS can redeliver a task."""
    handler = TASK_HANDLERS.get(task.task_type)
    if handler is None:
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message=f"Task type {task.task_type} is not supported yet",
        )
    return handler(task, dependencies)
