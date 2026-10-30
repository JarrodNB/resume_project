"""Read one live owned study job and successful generated question prompts.

Narrow database views hide task results and unrelated task fields. The current
command must match its queued durable task, owner, type and Job subject first.
"""
from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus

from database.open_read_only_connection import open_read_only_connection
from schemas.study_guide import StudyGuideInput


def read_study_guide_sources(connection, task):
    """Return no source for expired, finished, missing or mismatched work."""
    if task.task_type != "generate_study_guide":
        return None
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction():
        row = connection.execute("""
            SELECT job_id, description FROM ai_study_guide_commands
            WHERE task_id = %(task_id)s AND user_id = %(user_id)s
              AND job_id::text = %(job_id)s AND status = 'queued'
              AND created_at >= now() - interval '15 minutes'
        """, {"task_id": task.ai_task_id, "user_id": task.user_id,
                "job_id": str(task.input.get("job_id", ""))}).fetchone()
        if row is None:
            return None
        prompts = connection.execute("""
            SELECT question FROM ai_study_guide_questions
            WHERE user_id = %(user_id)s AND job_id = %(job_id)s
              AND task_id != %(task_id)s
            ORDER BY created_at, task_id, position
            LIMIT 201
        """, {"user_id": task.user_id, "job_id": row["job_id"],
                "task_id": task.ai_task_id}).fetchall()
        return StudyGuideInput(job_id=row["job_id"], description=row["description"],
                               previous_questions=[item["question"] for item in prompts])


def build_study_guide_reader(settings):
    """One read-only connection per execution; database outages retain retries."""
    def read(task):
        with open_read_only_connection(settings) as connection:
            return read_study_guide_sources(connection, task)
    return read
