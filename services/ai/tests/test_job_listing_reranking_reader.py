"""Verify real catalogue loading, bounded rendering and owned command selection."""
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.job_listing_reranking import read_reranking_input
from tests import test_career_library_reader as fixtures
from tests.test_career_library_reader import _insert, _insert_user
from worker.queue_messages import AiTaskMessage

pytestmark = pytest.mark.db


@pytest.fixture
def admin_connection():
    yield from fixtures.admin_connection.__wrapped__()


def seed(connection, legacy=False, count=1):
    owner = _insert_user(connection)
    ids = [_insert(connection, "job_board_listings", provider_id=uuid4().int % 10**15,
                   payload=Jsonb({"title": "開発者", "description": "<p>資料 &amp; API</p><ul><li>Build</li></ul>" + "資料" * 4000})) for _ in range(count)]
    command = {"keyword": "Ruby", "listing_ids": [str(id) for id in ids]}
    if legacy:
        command = {"keyword": "Ruby", "listings": [{"id": str(id), "text": "POISON COPY"} for id in ids]}
    task_id = _insert(connection, "ai_tasks", user_id=owner, task_type="rerank_job_listings", status="queued", input=Jsonb(command))
    return AiTaskMessage(ai_task_id=task_id, user_id=owner, task_type="rerank_job_listings", input={"listing_ids": [str(uuid4())]}), ids


@pytest.mark.parametrize("legacy,count", [(False, 1), (True, 1), (False, 100)])
def test_current_catalogue_is_authoritative_and_utf8_bounded(admin_connection, legacy, count):
    task, ids = seed(admin_connection, legacy, count)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    result = read_reranking_input(admin_connection, task)
    assert [item.id for item in result.listings] == ids
    assert result.listings[0].text.startswith("Job: 開発者\nDescription:\n資料 & API\n\n- Build")
    assert all("POISON" not in item.text for item in result.listings)
    assert all(len(item.text.encode()) <= min(6000, 140000 // count) for item in result.listings)
    assert sum(len(item.text.encode()) for item in result.listings) <= 140000


@pytest.mark.parametrize("mismatch", ["owner", "type", "completed", "missing"])
def test_rejects_ineligible_command_before_catalogue_work(admin_connection, mismatch):
    task, ids = seed(admin_connection)
    if mismatch == "owner":
        task = task.model_copy(update={"user_id": uuid4()})
    elif mismatch == "type":
        task = task.model_copy(update={"task_type": "analyze_gaps"})
    elif mismatch == "completed":
        admin_connection.execute("UPDATE ai_tasks SET status='completed' WHERE id=%s", [task.ai_task_id])
    else:
        admin_connection.execute("DELETE FROM job_board_listings WHERE id=%s", [ids[0]])
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_reranking_input(admin_connection, task) is None
