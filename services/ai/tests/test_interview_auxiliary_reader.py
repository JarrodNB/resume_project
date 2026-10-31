"""Exercise owned auxiliary source reads under the actual restricted SQL role."""

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.interview_auxiliary import read_interview_auxiliary
from interviews.client import REAL_CONFIGURATION
from tests import test_career_library_reader as library_tests
from tests.test_career_library_reader import _insert, _insert_user

admin_connection = library_tests.admin_connection
from worker.queue_messages import AiTaskMessage

pytestmark = pytest.mark.db


def seed(connection, kind="clarification", *, follow_up=False):
    user = _insert_user(connection)
    now = datetime.now(UTC)
    session = _insert(
        connection,
        "interview_sessions",
        user_id=user,
        status="active",
        execution_mode="real",
        expires_at=now + timedelta(days=1),
        preparation_kind="fictional_role",
        execution_config=Jsonb(REAL_CONFIGURATION.model_dump()),
        prepared_role=Jsonb({"title": "Generated role"}),
    )
    question = _insert(
        connection,
        "interview_session_questions",
        interview_session_id=session,
        position=0,
        content="Original core question?",
    )
    message = _insert(
        connection,
        "interview_session_messages",
        interview_session_id=session,
        question_id=question,
        kind="opening",
        position=0,
        semantic_key="opening",
        content="Current generated question?",
        acknowledgement="Never use acknowledgement",
    )
    _insert(
        connection,
        "interview_session_messages",
        interview_session_id=session,
        question_id=question,
        kind="answer",
        position=1,
        semantic_key="answer",
        content="My accepted answer.",
    )
    if follow_up:
        message = _insert(
            connection,
            "interview_session_messages",
            interview_session_id=session,
            question_id=question,
            kind="follow_up",
            position=2,
            semantic_key="followup",
            content="Follow-up?",
        )
    table = {
        "clarification": "interview_clarifications",
        "references": "interview_career_references",
        "session_feedback": "interview_session_feedbacks",
    }[kind]
    record_id = uuid4()
    key = {
        "clarification": "clarification_id",
        "references": "reference_id",
        "session_feedback": "feedback_id",
    }[kind]
    command = {key: str(record_id)}
    task_id = _insert(
        connection,
        "ai_tasks",
        user_id=user,
        task_type="interview_" + kind,
        subject_type="InterviewSession",
        subject_id=session,
        input=Jsonb(command),
    )
    # Insert helper creates a random id; the command must name this exact generated row.
    attrs = {"expected_revision": 0} if kind == "session_feedback" else {"message_id": message}
    record_id = _insert(
        connection,
        table,
        interview_session_id=session,
        ai_task_id=task_id,
        claimed_at=now,
        deadline=now + timedelta(minutes=3),
        attempt_count=1,
        **attrs,
    )
    command[key] = str(record_id)
    connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(command), task_id))
    if kind == "session_feedback":
        connection.execute(
            "UPDATE interview_sessions SET status='completed' WHERE id=%s", (session,)
        )
    task = AiTaskMessage(
        ai_task_id=task_id, user_id=user, task_type="interview_" + kind, input=command
    )
    grant = {
        "allowed": True,
        "record_id": str(record_id),
        "interview_id": str(session),
        "claimed_at": now.isoformat(),
    }
    return task, grant, table, question, message


def read(connection, task, grant):
    with connection.transaction():
        connection.execute("SET LOCAL ROLE ai_reader")
        result = read_interview_auxiliary(connection, task, grant)
        connection.execute("RESET ROLE")
        return result


@pytest.mark.parametrize("kind", ["clarification", "references", "session_feedback"])
def test_reads_canonical_source_and_ignores_legacy_copies(admin_connection, kind):
    task, grant, _, question, _ = seed(admin_connection, kind, follow_up=kind == "references")
    if kind != "session_feedback":
        task.input["question_text"] = "FORGED LEGACY COPY"
        task.input["query_text"] = "FORGED QUERY"
        admin_connection.execute("UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(task.input),task.ai_task_id))
    value = read(admin_connection, task, grant)
    if kind == "session_feedback":
        assert str(value.questions[0].question_id) == str(question)
        assert value.questions[0].dialogue[0].content == "My accepted answer."
        assert value.role.title == "Generated role"
    else:
        assert value["question_text"] == (
            "Follow-up?" if kind == "references" else "Current generated question?"
        )
        if kind == "references":
            assert (
                value["query_text"]
                == "Original core question?\n\nMy accepted answer.\n\nFollow-up?"
            )
        assert "FORGED" not in str(value) and "acknowledgement" not in str(value)


@pytest.mark.parametrize("kind", ["clarification", "references", "session_feedback"])
@pytest.mark.parametrize(
    "invalid",
    [
        "foreign",
        "unclaimed",
        "expired",
        "retry",
        "failed",
        "deleted",
        "wrong_type",
        "wrong_subject",
    ],
)
def test_rejects_invalid_claim_before_source_use(admin_connection, kind, invalid):
    task, grant, table, _, _ = seed(admin_connection, kind)
    if invalid == "foreign":
        task.user_id = uuid4()
    if invalid == "unclaimed":
        admin_connection.execute(f"UPDATE {table} SET claimed_at=NULL")
    if invalid == "expired":
        admin_connection.execute(
            "UPDATE interview_sessions SET expires_at=now()-interval '1 second'"
        )
    if invalid == "retry":
        admin_connection.execute(f"UPDATE {table} SET ai_task_id=NULL")
    if invalid == "failed":
        admin_connection.execute("UPDATE ai_tasks SET status='failed'")
    if invalid == "deleted":
        admin_connection.execute("UPDATE interview_sessions SET content_purged_at=now()")
    if invalid == "wrong_type":
        admin_connection.execute("UPDATE ai_tasks SET task_type='analyze_gaps'")
    if invalid == "wrong_subject":
        admin_connection.execute("UPDATE ai_tasks SET subject_type='Job'")
    with pytest.raises(ValueError):
        read(admin_connection, task, grant)


@pytest.mark.parametrize("invalid", ["later_prompt", "position", "digest", "revision", "too_long"])
def test_rejects_changed_prompt_or_completed_revision(admin_connection, invalid):
    task, grant, _, question, _message = seed(
        admin_connection, "session_feedback" if invalid == "revision" else "references"
    )
    if invalid == "later_prompt":
        _insert(
            admin_connection,
            "interview_session_messages",
            interview_session_id=grant["interview_id"],
            question_id=question,
            kind="follow_up",
            position=2,
            semantic_key="new",
            content="New question?",
        )
    if invalid == "too_long":
        admin_connection.execute("UPDATE interview_session_messages SET content=%s WHERE id=%s", ("x"*4001,_message))
    if invalid == "position":
        admin_connection.execute("UPDATE interview_sessions SET current_question_position=1")
    if invalid == "revision":
        admin_connection.execute("UPDATE interview_sessions SET revision=1")
    if invalid == "digest":
        command = {**task.input, "question_digest": sha256(b"Changed question").hexdigest()}
        admin_connection.execute(
            "UPDATE ai_tasks SET input=%s WHERE id=%s", (Jsonb(command), task.ai_task_id)
        )
    with pytest.raises(ValueError):
        read(admin_connection, task, grant)


@pytest.mark.parametrize("kind", ["clarification", "references", "session_feedback"])
def test_configured_handler_hydrates_without_injected_reader(task_dependencies, monkeypatch, kind):
    import os
    from dataclasses import replace

    import httpx
    import psycopg
    from psycopg.rows import dict_row
    from pydantic_ai.models.test import TestModel

    from agents.interview_clarification_agent import interview_clarification_agent
    from agents.interview_session_feedback_agent import interview_session_feedback_agent
    from worker.task_handlers import handle_ai_task

    database = os.environ["DB_NAME"]
    assert database.endswith("_test")
    with psycopg.connect(
        host=os.environ["DB_HOST"],
        dbname=database,
        user=os.environ.get("DB_ADMIN_USERNAME", "postgres"),
        password=os.environ.get("DB_ADMIN_PASSWORD", "postgres"),
        row_factory=dict_row,
        autocommit=True,
    ) as admin:
        task, grant, table, question, _ = seed(admin, kind)
        try:
            settings = task_dependencies.settings.model_copy(
                update={
                    "db_host": os.environ["DB_HOST"],
                    "db_name": database,
                    "db_username": "ai_reader",
                    "db_password": os.environ.get("DB_PASSWORD", "ai_reader"),
                    "interview_service_secret": "test-secret",
                }
            )
            deps = replace(
                task_dependencies,
                settings=settings,
                http_client=httpx.Client(
                    transport=httpx.MockTransport(lambda _: httpx.Response(200, json=grant))
                ),
            )
            assert deps.read_interview_auxiliary is None
            monkeypatch.setattr(
                "worker.interview_references_handler.retrieve_references", lambda *args: ([], None)
            )
            output = {
                "summary": "Practice showing the outcome.",
                "questions": [
                    {
                        "question_id": str(question),
                        "strengths": ["Specific contribution."],
                        "improvements": ["State the outcome."],
                        "example_answer": "I built a scheduler. [Add the result.]",
                    }
                ],
            }
            with (
                interview_clarification_agent.override(
                    model=TestModel(custom_output_args={"explanation": "Explain your choices."})
                ),
                interview_session_feedback_agent.override(
                    model=TestModel(custom_output_args=output)
                ),
            ):
                result = handle_ai_task(task, deps)
            assert result.status == "completed", result.error_message
        finally:
            admin.execute(
                f"DELETE FROM {table} WHERE interview_session_id=%s", (grant["interview_id"],)
            )
            admin.execute("DELETE FROM ai_tasks WHERE user_id=%s", (task.user_id,))
            admin.execute(
                "DELETE FROM interview_session_messages WHERE interview_session_id=%s",
                (grant["interview_id"],),
            )
            admin.execute(
                "DELETE FROM interview_session_questions WHERE interview_session_id=%s",
                (grant["interview_id"],),
            )
            admin.execute("DELETE FROM interview_sessions WHERE id=%s", (grant["interview_id"],))
            admin.execute("DELETE FROM users WHERE id=%s", (task.user_id,))


def test_reference_refresh_attempts_remain_readable_after_two_attempts(admin_connection):
    task, grant, table, _, _ = seed(admin_connection, "references")
    admin_connection.execute(
        f"UPDATE {table} SET attempt_count=3 WHERE id=%s", (grant["record_id"],)
    )
    assert read(admin_connection, task, grant)["question_text"] == "Current generated question?"
