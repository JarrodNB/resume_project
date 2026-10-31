"""Exercise current tailoring sources and ownership using the actual restricted role."""

from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from database.tailoring_sources import read_tailoring_sources
from tests import test_career_library_reader as fixtures
from tests.test_career_library_reader import _insert, _insert_user

pytestmark = pytest.mark.db


@pytest.fixture
def admin_connection():
    yield from fixtures.admin_connection.__wrapped__()


def sources(connection):
    owner = _insert_user(connection, summary="Current saved summary")
    connection.execute("UPDATE users SET name = 'Current Name', location = 'Manila', links = %s WHERE id = %s",
                       (Jsonb([{"label": "Portfolio", "url": "https://example.test"}]), owner))
    job = _insert(connection, "jobs", user_id=owner, title="Current role", company="Co")
    analysis = _insert(connection, "ai_tasks", user_id=owner, task_type="analyze_gaps",
                       status="completed", subject_type="Job", subject_id=job,
                       result=Jsonb({"gap_analysis": {"summary": "Generated comparison", "assessments": []}}))
    response = _insert(connection, "job_gap_responses", job_id=job, requirement="Python",
                       body="Current saved answer", screened_fields=["requirement"])
    task = _insert(connection, "ai_tasks", user_id=owner, task_type="tailor_resume",
                   status="queued", subject_type="Job", subject_id=job)
    return owner, job, analysis, response, task


def test_reads_current_sources_with_exact_receipts_as_ai_reader(admin_connection):
    owner, job, analysis, response, task = sources(admin_connection)
    # A source edited after command creation is read live, rather than from an old task copy.
    admin_connection.execute("UPDATE job_gap_responses SET body = 'Edited answer' WHERE id = %s", (response,))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    result = read_tailoring_sources(admin_connection, task, owner, job, analysis)
    assert result.contact["full_name"] == "Current Name"
    assert result.contact["location"] == "Manila"
    assert result.contact["links"][0]["label"] == "Portfolio"
    assert result.context.career_library.summary == "Current saved summary"
    assert result.gap_analysis["summary"] == "Generated comparison"
    assert result.gap_responses[0].id == str(response)
    assert result.gap_responses[0].body == "Edited answer"
    assert result.gap_responses[0].screened_fields == ["requirement"]


@pytest.mark.parametrize("mismatch", ["owner", "job", "analysis_owner", "analysis_job", "unfinished", "wrong_type", "deleted"])
def test_rejects_mismatched_sources_as_ai_reader(admin_connection, mismatch):
    owner, job, analysis, _, task = sources(admin_connection)
    other_owner = _insert_user(admin_connection)
    other_job = _insert(admin_connection, "jobs", user_id=owner, title="Other", company="Co")
    if mismatch == "analysis_owner":
        admin_connection.execute("UPDATE ai_tasks SET user_id = %s WHERE id = %s", (other_owner, analysis))
    elif mismatch == "analysis_job":
        admin_connection.execute("UPDATE ai_tasks SET subject_id = %s WHERE id = %s", (other_job, analysis))
    elif mismatch == "unfinished":
        admin_connection.execute("UPDATE ai_tasks SET status = 'queued' WHERE id = %s", (analysis,))
    elif mismatch == "wrong_type":
        admin_connection.execute("UPDATE ai_tasks SET task_type = 'tailor_resume' WHERE id = %s", (analysis,))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_tailoring_sources(admin_connection, task, other_owner if mismatch == "owner" else owner,
        uuid4() if mismatch == "job" else job, uuid4() if mismatch == "deleted" else analysis) is None


def test_optional_comparison_does_not_select_unrequested_output(admin_connection):
    owner, job, _, _, task = sources(admin_connection)
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_tailoring_sources(admin_connection, task, owner, job, None).gap_analysis is None


@pytest.mark.parametrize("mismatch", ["job", "owner", "completed", "wrong_type", "missing"])
def test_rejects_wrong_execution_subject_as_ai_reader(admin_connection, mismatch):
    owner, job, analysis, _, task = sources(admin_connection)
    if mismatch == "job":
        other = _insert(admin_connection, "jobs", user_id=owner, title="Other", company="Co")
        admin_connection.execute("UPDATE ai_tasks SET subject_id = %s WHERE id = %s", (other, task))
    elif mismatch == "owner":
        other = _insert_user(admin_connection)
        admin_connection.execute("UPDATE ai_tasks SET user_id = %s WHERE id = %s", (other, task))
    elif mismatch == "completed":
        admin_connection.execute("UPDATE ai_tasks SET status = 'completed' WHERE id = %s", (task,))
    elif mismatch == "wrong_type":
        admin_connection.execute("UPDATE ai_tasks SET task_type = 'analyze_gaps' WHERE id = %s", (task,))
    admin_connection.execute("SET LOCAL ROLE ai_reader")
    assert read_tailoring_sources(admin_connection, uuid4() if mismatch == "missing" else task,
                                 owner, job, analysis) is None
