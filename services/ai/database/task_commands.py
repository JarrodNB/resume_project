"""Load a queued task's owned durable command before any tracing or paid work.

Both legacy and identity-only notifications use the database value. Queue content cannot
replace stored sources, select another owner, or reopen finished tasks. Rails owns writes.
"""

from database.open_read_only_connection import open_read_only_connection
from worker.queue_messages import AiTaskMessage

TASK_COMMAND_QUERY = """
    SELECT input FROM ai_tasks
    WHERE id = %(ai_task_id)s AND user_id = %(user_id)s
      AND task_type = %(task_type)s AND status = 'queued'
"""


def read_task_command(connection, notification: AiTaskMessage) -> AiTaskMessage | None:
    """Return the matching queued command, or nothing for stale/foreign work."""
    row = connection.execute(TASK_COMMAND_QUERY, {
        "ai_task_id": notification.ai_task_id,
        "user_id": notification.user_id,
        "task_type": notification.task_type,
    }).fetchone()
    if row is None:
        return None
    # Revalidate durable input with the same legacy normalization used by handlers.
    return AiTaskMessage.model_validate({
        "ai_task_id": notification.ai_task_id,
        "user_id": notification.user_id,
        "task_type": notification.task_type,
        "input": row["input"],
    })


def build_task_command_reader(settings):
    """Use one read-only connection per delivery; connection errors remain retryable."""
    def read(notification):
        with open_read_only_connection(settings) as connection:
            return read_task_command(connection, notification)
    return read
