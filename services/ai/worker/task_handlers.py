"""
Description: Turns a task message into a result message. Echoes the input for now; dispatch to
Pydantic AI agents by task_type replaces the echo in build step 4.
Index:
    - handle_ai_task: runs one task and returns its result
"""

from worker.queue_messages import AiResultMessage, AiTaskMessage


def handle_ai_task(task: AiTaskMessage) -> AiResultMessage:
    """Runs one task. Must be safe to run twice, because SQS can redeliver a task."""
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        result={"echo": task.input, "task_type": task.task_type},
    )
