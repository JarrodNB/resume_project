"""Read canonical interview help after Rails grants one bounded attempt.

Claims carry identities and a timestamp fence. Questions and accepted dialogue stay
in their original rows; all reads are owned, coherent and read-only.
"""

from hashlib import sha256

from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus

from database.open_read_only_connection import open_read_only_connection
from schemas.interview_session_feedback import FeedbackClaim

TABLES = {
    "interview_clarification": ("interview_clarifications", "clarification_id"),
    "interview_references": ("interview_career_references", "reference_id"),
    "interview_session_feedback": ("interview_session_feedbacks", "feedback_id"),
}


def read_interview_auxiliary(connection, task, grant):
    """Reject stale, foreign, replaced or expired claimed attempts before source reads."""
    table, key = TABLES[task.task_type]
    params = {
        "task": task.ai_task_id,
        "user": task.user_id,
        "record": grant["record_id"],
        "session": grant["interview_id"],
        "claimed": grant["claimed_at"],
    }
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout = '5s'")
        query = f"""SELECT r.id::text, r.claimed_at, r.deadline, s.status, s.revision,
          s.current_question_position, s.preparation_kind, s.prepared_role, t.input,
          {"r.expected_revision" if key == "feedback_id" else "r.message_id::text"}
          FROM {table} r JOIN interview_sessions s ON s.id=r.interview_session_id
          JOIN ai_tasks t ON t.id=r.ai_task_id AND t.user_id=s.user_id
          WHERE t.id=%(task)s AND t.task_type=%(kind)s AND t.status='queued'
          AND t.subject_type='InterviewSession' AND t.subject_id=s.id
          AND s.user_id=%(user)s AND s.id=%(session)s AND r.id=%(record)s
          AND r.claimed_at=%(claimed)s::timestamptz AND r.attempt_count >= 1
          {"" if key == "reference_id" else "AND r.attempt_count <= 2"}
          AND r.deadline>CURRENT_TIMESTAMP
          AND s.expires_at>CURRENT_TIMESTAMP AND s.content_purged_at IS NULL
          AND s.execution_mode='real'"""
        row = cursor.execute(query, {**params, "kind": task.task_type}).fetchone()
        if (
            row is None
            or row["input"].get(key) != row["id"]
            or str(task.input.get(key)) != row["id"]
        ):
            raise ValueError("Interview help claim is no longer available")
        if key == "feedback_id":
            if row["status"] != "completed" or row["expected_revision"] != row["revision"]:
                raise ValueError("Interview feedback revision changed")
            questions = cursor.execute(
                """SELECT q.id::text AS question_id, q.content AS question
              FROM interview_session_questions q JOIN interview_sessions s ON s.id=q.interview_session_id
              WHERE s.user_id=%(user)s AND s.id=%(session)s AND EXISTS
              (SELECT 1 FROM interview_session_messages m WHERE m.interview_session_id=s.id
               AND m.question_id=q.id AND m.kind='answer') ORDER BY q.position LIMIT 21""",
                params,
            ).fetchall()
            for question in questions:
                question["dialogue"] = cursor.execute(
                    """SELECT m.kind,m.content FROM interview_session_messages m
                  JOIN interview_sessions s ON s.id=m.interview_session_id
                  WHERE s.user_id=%(user)s AND s.id=%(session)s AND m.question_id=%(question_id)s
                  AND m.kind IN ('answer','follow_up') ORDER BY m.position LIMIT 8""",
                    {**params, **question},
                ).fetchall()
            result = FeedbackClaim.model_validate(
                {
                    "questions": questions,
                    "role": row["prepared_role"]
                    if row["preparation_kind"] == "fictional_role"
                    else {},
                }
            )
        else:
            message = cursor.execute(
                """SELECT m.content,m.kind,m.position,m.question_id::text,
              q.content AS opening,q.position AS question_position FROM interview_session_messages m
              JOIN interview_session_questions q ON q.id=m.question_id AND q.interview_session_id=m.interview_session_id
              JOIN interview_sessions s ON s.id=m.interview_session_id
              WHERE s.user_id=%(user)s AND s.id=%(session)s AND m.id=%(message)s
              AND m.kind IN ('opening','follow_up') AND NOT EXISTS
              (SELECT 1 FROM interview_session_messages later WHERE later.interview_session_id=s.id
               AND later.question_id=m.question_id AND later.kind IN ('opening','follow_up')
               AND later.position>m.position)""",
                {**params, "message": row["message_id"]},
            ).fetchone()
            if (
                message is None
                or not 1 <= len(message["content"]) <= 4000
                or row["status"] != "active"
                or message["question_position"] != row["current_question_position"]
            ):
                raise ValueError("Interview prompt is no longer current")
            query_text = message["content"]
            if key == "reference_id" and message["kind"] == "follow_up":
                answer = cursor.execute(
                    """SELECT m.content FROM interview_session_messages m
                  JOIN interview_sessions s ON s.id=m.interview_session_id
                  WHERE s.user_id=%(user)s AND s.id=%(session)s AND m.question_id=%(question_id)s
                  AND m.kind='answer' AND m.position<%(position)s ORDER BY m.position DESC LIMIT 1""",
                    {**params, **message},
                ).fetchone()
                parts = (
                    [message["opening"]]
                    + ([answer["content"]] if answer else [])
                    + [message["content"]]
                )
                candidate = "\n\n".join(parts)
                if len(candidate) <= 12004:
                    query_text = candidate
            for field, value in [
                ("question_digest", message["content"]),
                ("query_digest", query_text),
            ]:
                if (
                    field in row["input"]
                    and row["input"][field] != sha256(value.encode()).hexdigest()
                ):
                    raise ValueError("Interview prompt changed")
            if row["input"].get("message_id", row["message_id"]) != row["message_id"]:
                raise ValueError("Interview message changed")
            result = {"question_text": message["content"], "query_text": query_text}
        # clock_timestamp catches expiry while reading, unlike transaction-time CURRENT_TIMESTAMP.
        valid = cursor.execute(
            f"""SELECT 1 FROM {table} r JOIN interview_sessions s ON s.id=r.interview_session_id
          WHERE s.user_id=%(user)s AND s.id=%(session)s AND r.id=%(record)s
          AND r.deadline>clock_timestamp() AND s.expires_at>clock_timestamp()""",
            params,
        ).fetchone()
        if not valid:
            raise ValueError("Interview help expired while reading")
        return result


def build_interview_auxiliary_reader(settings):
    def read(task, grant):
        with open_read_only_connection(settings) as connection:
            return read_interview_auxiliary(connection, task, grant)

    return read
