"""Load one claimed interview's owned inputs through read-only database access.

Preparation reads current source records once. Later operations read only prepared
questions and accepted dialogue, never the original job or career library.
"""

from psycopg import Error, IsolationLevel
from psycopg.pq import TransactionStatus

from database.career_library_reader import read_career_library
from database.open_read_only_connection import open_read_only_connection
from interviews.client import (
    EarlierDialogue,
    PreparationPayload,
    SpeechPayload,
    TranscriptionPayload,
    TurnPayload,
)
from schemas.interview_setup import InterviewSetup

OPERATION_QUERY = """
SELECT o.kind, o.question_id::text, o.message_id::text, o.recording_id::text,
       o.expected_revision, o.candidate_transcript, o.transcription_mode,
       s.status AS session_status, s.execution_mode, s.revision, s.current_question_position,
       s.preparation_kind, s.setup_config
FROM interview_session_operations o
JOIN interview_sessions s ON s.id = o.interview_session_id
WHERE o.id = %(operation_id)s AND s.id = %(interview_id)s AND s.user_id = %(user_id)s
 AND o.attempt_id = %(attempt_id)s AND o.claim_generation = %(generation)s
 AND o.status = 'running' AND o.lease_expires_at > CURRENT_TIMESTAMP
 AND o.execution_deadline > CURRENT_TIMESTAMP AND s.expires_at > CURRENT_TIMESTAMP
 AND s.status NOT IN ('expired', 'abandoned') AND s.content_purged_at IS NULL
"""
SOURCE_FIELDS = {
    "experiences": ("title", "company", "description"),
    "projects": ("name", "role", "description"),
    "educations": ("institution", "degree", "field_of_study", "description"),
    "certifications": ("name", "issuer", "description"),
    "skills": ("name",),
    "career_contexts": ("response",),
}


def _preparation(cursor, row, params):
    if row["session_status"] != "preparing":
        raise ValueError("Preparation is no longer active")
    choices = cursor.execute(
        "SELECT job_id::text, career_focus FROM interview_sessions WHERE id = %(interview_id)s AND user_id = %(user_id)s",
        params,
    ).fetchone()
    library = read_career_library(cursor.connection, params["user_id"])
    sources = []
    if library.summary:
        sources.append(
            {
                "type": "profile",
                "id": params["user_id"],
                "field": "summary",
                "text": library.summary,
            }
        )
    for kind, fields in SOURCE_FIELDS.items():
        for record in getattr(library, kind):
            for field in fields:
                value = getattr(record, field, None)
                if isinstance(value, str) and value.strip():
                    sources.append({"type": kind, "id": record.id, "field": field, "text": value})
            if kind == "experiences":
                sources.extend(
                    {"type": "highlights", "id": h.id, "field": "content", "text": h.content}
                    for h in record.highlights
                    if h.content
                )
    if not sources:
        raise ValueError("Career library is empty")
    contact = cursor.execute(
        "SELECT name, contact_email, phone FROM users WHERE id = %(user_id)s", params
    ).fetchone()
    context = {
        "version": 1,
        "sources": sources,
        "career_focus": choices["career_focus"],
        "names": [contact["name"]] if contact["name"] else [],
        "emails": [contact["contact_email"]] if contact["contact_email"] else [],
        "phones": [contact["phone"]] if contact["phone"] else [],
    }
    context["avoided_questions"] = [
        r["question_text"]
        for r in cursor.execute(
            "SELECT question_text FROM avoided_interview_questions WHERE user_id = %(user_id)s ORDER BY created_at, id LIMIT 51",
            params,
        ).fetchall()
    ]
    if row["preparation_kind"] == "saved_job":
        job = cursor.execute(
            """SELECT id::text, title, company, description, requirements,
            responsibilities, nice_to_haves FROM jobs WHERE id = %(job_id)s AND user_id = %(user_id)s""",
            {**params, "job_id": choices["job_id"]},
        ).fetchone()
        if job is None:
            raise ValueError("Required saved job is unavailable")
        context["job"] = job
    return PreparationPayload(preparation_context=context, setup=params["setup"])


def _spoken(message):
    return "\n\n".join(
        value for value in (message["acknowledgement"], message["content"]) if value is not None
    )


def _dialogue(cursor, params):
    return cursor.execute(
        """SELECT m.question_id::text, m.kind, m.content, m.acknowledgement,
        q.position AS question_position, q.skipped_at
        FROM interview_session_messages m JOIN interview_session_questions q
          ON q.id = m.question_id AND q.interview_session_id = m.interview_session_id
        JOIN interview_sessions s ON s.id = m.interview_session_id
        WHERE s.user_id = %(user_id)s AND m.interview_session_id = %(interview_id)s AND m.kind IN ('opening','answer','follow_up')
        ORDER BY m.position""",
        params,
    ).fetchall()


def read_interview_input(connection, claim):
    """Validate owner and live execution fences before selecting narrow operation inputs."""
    params = {
        "operation_id": claim.operation_id,
        "interview_id": claim.payload.interview_id,
        "user_id": claim.payload.user_id,
        "attempt_id": claim.attempt_id,
        "generation": claim.claim_generation,
        "setup": claim.payload.setup,
    }
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout = '5s'")
        row = cursor.execute(OPERATION_QUERY, params).fetchone()
        if (
            row is None
            or row["kind"] != claim.kind
            or row["execution_mode"] != claim.execution_mode
        ):
            raise ValueError("Claim is stale or does not own this interview")
        saved_setup = InterviewSetup.model_validate({"question_count": 9, **row["setup_config"]})
        if saved_setup != claim.payload.setup:
            raise ValueError("Interview settings do not match")
        if claim.kind == "preparation":
            payload = _preparation(cursor, row, params)
        elif claim.kind == "speech":
            message = cursor.execute(
                """SELECT m.content, m.acknowledgement FROM interview_session_messages m
                JOIN interview_sessions s ON s.id = m.interview_session_id
                WHERE s.user_id = %(user_id)s AND m.id = %(message_id)s AND m.interview_session_id = %(interview_id)s AND m.question_id = %(question_id)s""",
                {**params, **row},
            ).fetchone()
            if message is None:
                raise ValueError("Speech message unavailable")
            payload = SpeechPayload(text=_spoken(message), message_id=row["message_id"])
        else:
            question = cursor.execute(
                """SELECT q.content, q.position FROM interview_session_questions q
                JOIN interview_sessions s ON s.id = q.interview_session_id
                WHERE s.user_id = %(user_id)s AND q.id = %(question_id)s AND q.interview_session_id = %(interview_id)s""",
                {**params, **row},
            ).fetchone()
            if (
                question is None
                or row["session_status"] != "active"
                or row["revision"] != row["expected_revision"]
                or row["current_question_position"] != question["position"]
            ):
                raise ValueError("Interview revision is stale")
            if claim.kind == "transcription":
                payload = TranscriptionPayload(recording_id=row["recording_id"])
            else:
                messages = _dialogue(cursor, params)
                current = [
                    {"kind": m["kind"], "content": _spoken(m)}
                    for m in messages
                    if m["question_id"] == row["question_id"]
                ]
                groups = {}
                for message in messages:
                    position = message["question_position"]
                    if position < question["position"]:
                        groups.setdefault(position, []).append(message)
                remaining, selected, omitted = 12000, [], []
                for position, group in sorted(groups.items(), reverse=True):
                    if not any(m["kind"] == "answer" for m in group):
                        continue
                    if group[-1]["skipped_at"] and group[-1]["kind"] == "follow_up":
                        group = group[:-1]
                    rendered = [{"kind": m["kind"], "content": _spoken(m)} for m in group]
                    size = sum(len(m["content"]) for m in rendered)
                    if size <= remaining:
                        selected.append({"question_position": position, "messages": rendered})
                        remaining -= size
                    else:
                        omitted.append(position)
                contact = cursor.execute(
                    "SELECT name, contact_email, phone FROM users WHERE id = %(user_id)s", params
                ).fetchone()
                privacy = {
                    "names": [contact["name"]] if contact["name"] else [],
                    "emails": [contact["contact_email"]] if contact["contact_email"] else [],
                    "phones": [contact["phone"]] if contact["phone"] else [],
                }
                role = {}
                if row["preparation_kind"] == "fictional_role":
                    role = cursor.execute(
                        "SELECT prepared_role FROM interview_sessions WHERE id = %(interview_id)s AND user_id = %(user_id)s",
                        params,
                    ).fetchone()["prepared_role"]
                context = {
                    "interview_context": {
                        "version": 1,
                        "personal_evidence": privacy,
                        "fictional_role": role,
                    }
                }
                if claim.execution_mode == "fake":
                    fixture = cursor.execute(
                        "SELECT fixture_context FROM interview_sessions WHERE id = %(interview_id)s AND user_id = %(user_id)s",
                        params,
                    ).fetchone()["fixture_context"]
                    context = {"fixture_context": fixture}
                payload = TurnPayload(
                    setup=params["setup"],
                    candidate_transcript=row["candidate_transcript"],
                    transcription_mode=row["transcription_mode"],
                    recording_id=row["recording_id"],
                    expected_revision=row["expected_revision"],
                    question=question["content"],
                    current_dialogue=current,
                    earlier_dialogue=EarlierDialogue(
                        version=1,
                        character_budget=12000,
                        groups=selected[::-1],
                        omitted_question_positions=sorted(omitted),
                    ),
                    **context,
                )
    return claim.model_copy(update={"payload": payload})


def build_interview_input_reader(settings):
    def read(claim):
        with open_read_only_connection(settings) as connection:
            return read_interview_input(connection, claim)

    return read


def interview_database_ready(settings):
    """Check connection and essential reader grants without selecting any user's data."""
    if settings.db_username != "ai_reader":
        return False
    empty_id = "00000000-0000-0000-0000-000000000000"
    params = {"operation_id": empty_id, "interview_id": empty_id, "user_id": empty_id,
              "attempt_id": empty_id, "generation": 0}
    try:
        with open_read_only_connection(settings) as connection:
            connection.execute("SET LOCAL statement_timeout = '2s'")
            connection.execute(OPERATION_QUERY + " LIMIT 0", params)
            connection.execute("SELECT content, acknowledgement, position FROM interview_session_messages LIMIT 0")
            connection.execute("SELECT content, position, skipped_at FROM interview_session_questions LIMIT 0")
        return True
    except Error:
        return False
