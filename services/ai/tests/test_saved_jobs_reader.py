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
