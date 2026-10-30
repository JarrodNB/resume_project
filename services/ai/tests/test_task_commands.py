"""Exercise owned command hydration against real Postgres grants without provider calls."""

from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.task_commands import read_task_command
from tests import test_career_library_reader as database_fixtures
from tests.test_career_library_reader import _insert, _insert_user
from worker.queue_messages import AiTaskMessage

pytestmark = pytest.mark.db


@pytest.fixture
def admin_connection():
    yield from database_fixtures.admin_connection.__wrapped__()


@pytest.mark.parametrize("task_type,input", [
    ("analyze_gaps", {"job_id": "saved-job"}),
    ("scrape_job", {"url": "https://example.test/job"}),
    ("parse_resume", {"storage_key": "owned-upload"}),
    ("parse_job_posting", {"text": "Synthetic pasted job description"}),
    ("generate_summary", {"sources": [{"text": "Saved synthetic career fact"}]}),
])
def test_loads_owned_durable_command_as_reader(admin_connection, task_type, input):
    user_id = _insert_user(admin_connection)
    task_id = _insert(admin_connection, "ai_tasks", user_id=user_id,
                      task_type=task_type, status="queued", input=Jsonb(input))
    notification = AiTaskMessage(ai_task_id=task_id, user_id=user_id, task_type=task_type,
                                 input={"text": "UNTRUSTED QUEUED COPY"})
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    task = read_task_command(admin_connection, notification)
    assert task.input == input
    assert task.ai_task_id == task_id


@pytest.mark.parametrize("mismatch", ["user", "type", "missing", "completed", "failed", "needs_user_input"])
def test_ineligible_notifications_read_nothing(admin_connection, mismatch):
    user_id = _insert_user(admin_connection)
    task_id = _insert(admin_connection, "ai_tasks", user_id=user_id,
                      task_type="analyze_gaps", status=mismatch if mismatch in
                      {"completed", "failed", "needs_user_input"} else "queued",
                      input=Jsonb({"job_id": "saved-job"}))
    notification = AiTaskMessage(ai_task_id=uuid4() if mismatch == "missing" else task_id,
                                 user_id=uuid4() if mismatch == "user" else user_id,
                                 task_type="scrape_job" if mismatch == "type" else "analyze_gaps")
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_task_command(admin_connection, notification) is None
