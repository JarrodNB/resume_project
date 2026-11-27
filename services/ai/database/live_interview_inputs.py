"""Load what the live interviewer may know about one interview, read-only.

The live agent knows only the interview, user and live connection IDs from its dispatch. Every
read is scoped to that owner, and only while the connection is claimed (connected) and the
session is a live, active, unexpired interview. It reads the saved setup, the prepared
questions, the fictional role or current saved job, and the user's contact details (only so
they can be masked). It never reads career references, the career library or dialogue.
"""

from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus

from database.open_read_only_connection import open_read_only_connection
from live_interviews.instructions import LiveInterviewInputs
from privacy.known_contact import KnownContact
from schemas.interview_setup import InterviewSetup

SESSION_QUERY = """
SELECT s.setup_config, s.preparation_kind, s.prepared_role, s.job_id::text
FROM interview_sessions s
JOIN interview_live_connections c ON c.interview_session_id = s.id
WHERE s.id = %(interview_id)s AND s.user_id = %(user_id)s AND c.id = %(connection_id)s
  AND c.status = 'connected' AND s.conversation_mode = 'live' AND s.status = 'active'
  AND s.expires_at > CURRENT_TIMESTAMP AND s.content_purged_at IS NULL
"""


def read_live_interview_inputs(connection, *, interview_id, user_id, connection_id) -> LiveInterviewInputs:
    """Return the instruction inputs, or raise ValueError when the connection is not available."""
    params = {"interview_id": interview_id, "user_id": user_id, "connection_id": connection_id}
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout = '5s'")
        session = cursor.execute(SESSION_QUERY, params).fetchone()
        if session is None:
            raise ValueError("Live interview is not available")
        questions = cursor.execute(
            """SELECT q.content FROM interview_session_questions q
            JOIN interview_sessions s ON s.id = q.interview_session_id
            WHERE s.id = %(interview_id)s AND s.user_id = %(user_id)s ORDER BY q.position""",
            params,
        ).fetchall()
        job = None
        if session["preparation_kind"] == "saved_job":
            job = cursor.execute(
                """SELECT id::text, title, company, description, requirements, responsibilities,
                nice_to_haves FROM jobs WHERE id = %(job_id)s AND user_id = %(user_id)s""",
                {**params, "job_id": session["job_id"]},
            ).fetchone()
            if job is None:
                raise ValueError("Live interview is not available: its saved job was deleted")
        contact = cursor.execute(
            "SELECT name, contact_email, phone FROM users WHERE id = %(user_id)s", params
        ).fetchone()
    return LiveInterviewInputs(
        setup=InterviewSetup.model_validate({"question_count": 9, **session["setup_config"]}),
        questions=tuple(row["content"] for row in questions),
        role=None if job is not None else (session["prepared_role"] or None),
        job=dict(job) if job is not None else None,
        contact=KnownContact.from_values(names=[contact["name"]], emails=[contact["contact_email"]],
                                         phones=[contact["phone"]]),
    )


def build_live_interview_input_reader(settings):
    """Return a reader that opens one read-only connection per call."""

    def read(**ids) -> LiveInterviewInputs:
        with open_read_only_connection(settings) as connection:
            return read_live_interview_inputs(connection, **ids)

    return read
