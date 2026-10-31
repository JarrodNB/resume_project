"""Verify active owner scoping and stable saved-job ordering with real reader grants."""
from datetime import UTC, datetime

import pytest

from database.saved_jobs import read_saved_jobs
from tests.test_career_library_reader import _insert, _insert_user, admin_connection  # noqa: F401

pytestmark = pytest.mark.db


def test_only_owned_active_labels_are_read_in_stable_newest_order(admin_connection):  # noqa: F811
    connection = admin_connection
    owner = _insert_user(connection)
    other = _insert_user(connection)
    ids = [_insert(connection, "jobs", user_id=owner, title="Engineer", company="Acme") for _ in range(3)]
    connection.execute("UPDATE jobs SET created_at = %s WHERE id = %s", (datetime(2000, 1, 1, tzinfo=UTC), ids[0]))
    _insert(connection, "jobs", user_id=owner, title="Archived", archived_at=datetime.now(UTC))
    _insert(connection, "jobs", user_id=other, title="Private")
    connection.execute("SET LOCAL ROLE ai_reader")
    rows = read_saved_jobs(connection, owner)
    assert [row["id"] for row in rows] == [*sorted(map(str, ids[1:]), reverse=True), str(ids[0])]
    assert all(set(row) == {"id", "title", "company", "screened_fields"} for row in rows)


def test_summary_reads_current_owned_active_facts_only(admin_connection):  # noqa: F811
    from psycopg.types.json import Jsonb

    from database.saved_jobs import read_job_summary
    connection = admin_connection
    owner, other = _insert_user(connection), _insert_user(connection)
    selected = _insert(connection, 'jobs', user_id=owner, title='Engineer', company='Acme', location='Remote',
                       requirements=Jsonb(['Python']), responsibilities=Jsonb(['Build']), nice_to_haves=Jsonb(['SQL']), notes='PRIVATE')
    archived = _insert(connection, 'jobs', user_id=owner, title='Engineer', archived_at=datetime.now(UTC))
    connection.execute('SET LOCAL ROLE ai_reader')
    row = read_job_summary(connection, owner, selected)
    assert row['location'] == 'Remote' and row['requirements'] == ['Python']
    assert set(row) == {'id', 'title', 'company', 'location', 'requirements', 'responsibilities', 'nice_to_haves', 'screened_fields'}
    assert read_job_summary(connection, other, selected) is None
    assert read_job_summary(connection, owner, archived) is None
    from uuid import uuid4
    assert read_job_summary(connection, owner, uuid4()) is None
