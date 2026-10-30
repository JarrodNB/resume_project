"""Exercise current-source selection and restrictive grants against synthetic Postgres rows."""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb
from pydantic import ValidationError

from database.study_guide_sources import read_study_guide_sources
from tests import test_career_library_reader as fixtures
from tests.test_career_library_reader import _insert, _insert_user
from worker.queue_messages import AiTaskMessage

pytestmark = pytest.mark.db


@pytest.fixture
def admin_connection():
    yield from fixtures.admin_connection.__wrapped__()


def setup(connection):
    user = _insert_user(connection)
    job = _insert(connection, "jobs", user_id=user, title="Clerk", company="Synthetic", description="CURRENT saved description")
    task = _insert(connection, "ai_tasks", user_id=user, subject_type="Job", subject_id=job,
                   task_type="generate_study_guide", status="queued",
                   input=Jsonb({"job_id": str(job), "description": "OLD COPIED SOURCE", "previous_questions": ["IGNORE COPIED HISTORY"]}))
    return AiTaskMessage(ai_task_id=task, user_id=user, task_type="generate_study_guide", input={"job_id": str(job)})


def batch(connection, task, prefix="Prior", **overrides):
    guide = {"version": 1, "title": "Saved", "questions": [
        {"question": f"{prefix} {i}?", "answer": "Teaching answer", "why_it_matters": "Relevance", "example": "Worked example"} for i in range(5)]}
    values = {"user_id": task.user_id, "subject_id": task.input["job_id"], "subject_type": "Job",
              "task_type": "generate_study_guide", "status": "completed", "result": Jsonb({"study_guide": guide})}
    values.update(overrides)
    return _insert(connection, "ai_tasks", **values)


def test_reads_current_description_and_ordered_valid_owned_questions(admin_connection):
    task = setup(admin_connection)
    first = batch(admin_connection, task, "First")
    admin_connection.execute("UPDATE ai_tasks SET created_at = created_at - interval '1 minute' WHERE id = %s", [first])
    batch(admin_connection, task, "Second")
    batch(admin_connection, task, "Failed", status="failed")
    batch(admin_connection, task, "Foreign", user_id=_insert_user(admin_connection))
    batch(admin_connection, task, "Other type", task_type="analyze_gaps")
    batch(admin_connection, task, "Malformed", result=Jsonb({"study_guide": {"version": 1, "title": "Bad", "questions": []}}))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    loaded = read_study_guide_sources(admin_connection, task)
    assert loaded.description == "CURRENT saved description"
    assert loaded.previous_questions == [f"{prefix} {i}?" for prefix in ("First", "Second") for i in range(5)]
    # A repeat read changes no state and cannot include the current queued task.
    assert read_study_guide_sources(admin_connection, task) == loaded


@pytest.mark.parametrize("mismatch", ["missing_task", "stored_type", "user", "command_job", "stored_job", "subject", "foreign_subject", "type", "finished", "expired", "deleted"])
def test_rejects_ineligible_task_before_sources(admin_connection, mismatch):
    task = setup(admin_connection)
    if mismatch == "missing_task": task.ai_task_id = uuid4()
    elif mismatch == "stored_type": admin_connection.execute("UPDATE ai_tasks SET task_type = 'analyze_gaps' WHERE id = %s", [task.ai_task_id])
    elif mismatch == "user": task.user_id = uuid4()
    elif mismatch == "command_job": task.input["job_id"] = str(uuid4())
    elif mismatch == "stored_job": admin_connection.execute("UPDATE ai_tasks SET input = '{}' WHERE id = %s", [task.ai_task_id])
    elif mismatch == "subject": admin_connection.execute("UPDATE ai_tasks SET subject_type = 'Resume' WHERE id = %s", [task.ai_task_id])
    elif mismatch == "foreign_subject": admin_connection.execute("UPDATE jobs SET user_id = %s WHERE id = %s", [_insert_user(admin_connection), task.input["job_id"]])
    elif mismatch == "type": task.task_type = "analyze_gaps"
    elif mismatch == "finished": admin_connection.execute("UPDATE ai_tasks SET status = 'completed' WHERE id = %s", [task.ai_task_id])
    elif mismatch == "expired": admin_connection.execute("UPDATE ai_tasks SET created_at = %s WHERE id = %s", [datetime.now(UTC) - timedelta(minutes=16), task.ai_task_id])
    elif mismatch == "deleted": admin_connection.execute("DELETE FROM jobs WHERE id = %s", [task.input["job_id"]])
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_study_guide_sources(admin_connection, task) is None


@pytest.mark.parametrize("count,length", [(41, 10), (9, 1000)])
def test_previous_context_bound_fails_without_dropping_prompts(admin_connection, count, length):
    task = setup(admin_connection)
    for i in range(count): batch(admin_connection, task, "x" * (length - 3))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    with pytest.raises(ValidationError): read_study_guide_sources(admin_connection, task)


def test_views_do_not_grant_raw_result_history_or_writes(admin_connection):
    task = setup(admin_connection)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_study_guide_sources(admin_connection, task).job_id
    assert admin_connection.execute("SELECT has_table_privilege(current_user, 'ai_study_guide_questions', 'DELETE') AS allowed").fetchone()["allowed"] is False
    for query in ["SELECT result FROM ai_tasks", "SELECT message_history FROM ai_tasks", "SELECT encrypted_password FROM users", "UPDATE jobs SET description = 'changed'"]:
        with pytest.raises(psycopg.errors.InsufficientPrivilege), admin_connection.transaction():
            admin_connection.execute(query)


def test_edit_after_enqueue_is_loaded(admin_connection):
    task = setup(admin_connection)
    admin_connection.execute("UPDATE jobs SET description = 'Edited after enqueue' WHERE id = %s", [task.input["job_id"]])
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_study_guide_sources(admin_connection, task).description == "Edited after enqueue"
