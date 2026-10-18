"""Read persisted classifier decisions with real owner and database role isolation."""

from uuid import uuid4

import psycopg
import pytest

pytest_plugins = ["tests.test_career_library_reader"]

from database.screening_decision_reader import read_screening_successes
from tests.test_career_library_reader import _insert_user

pytestmark = pytest.mark.db


def test_read_only_decisions_filter_owner_and_exact_pairs(admin_connection):
    connection = admin_connection
    owner, other = _insert_user(connection), _insert_user(connection)
    pair = ("a" * 64, "b" * 64)
    for user, digest, policy in [(owner, *pair), (other, "c" * 64, "d" * 64)]:
        connection.execute(
            "INSERT INTO screening_decisions (id, user_id, content_digest, policy_identity, created_at) "
            "VALUES (%s, %s, %s, %s, now())", (uuid4(), user, digest, policy),
        )
    connection.execute("SET LOCAL ROLE ai_reader")
    assert read_screening_successes(connection, owner, [pair, ("c" * 64, "d" * 64)]) == {pair}
    assert read_screening_successes(connection, other, [pair]) == set()
    assert read_screening_successes(connection, owner, [(pair[0], "e" * 64)]) == set()
    with pytest.raises(psycopg.errors.InsufficientPrivilege), connection.transaction():
        connection.execute("DELETE FROM screening_decisions")
