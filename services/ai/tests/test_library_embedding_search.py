"""
Description: Integration tests for career library hybrid search against the compose Postgres.
Seeds embeddings as the admin role inside a transaction that always rolls back, then searches as
ai_reader (SET LOCAL ROLE), so the real grants are exercised. Skipped when the database isn't
reachable. Run only these with `docker compose run --rm ai pytest -m db`.
Index:
    - admin_connection: a postgres connection inside a rolled-back transaction
    - test_returns_the_users_entries_nearest_first
    - test_keyword_match_outranks_a_nearer_vector
    - test_ignores_other_users_and_other_models
"""

import os
from collections.abc import Iterator
from uuid import UUID, uuid4

import psycopg
import pytest
from pgvector import Vector
from pgvector.psycopg import register_vector
from psycopg.rows import DictRow, dict_row

from database.library_embedding_search import search_career_library

pytestmark = pytest.mark.db

DIMENSIONS = 1536
MODEL = "text-embedding-3-small"


@pytest.fixture
def admin_connection() -> Iterator[psycopg.Connection[DictRow]]:
    """Connects as the admin role (seeding needs writes); everything is rolled back."""
    try:
        connection = psycopg.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            dbname=os.environ.get("DB_NAME", "api_development"),
            user=os.environ.get("DB_ADMIN_USERNAME", "postgres"),
            password=os.environ.get("DB_ADMIN_PASSWORD", "postgres"),
            connect_timeout=3,
            row_factory=dict_row,
        )
    except psycopg.OperationalError as error:
        pytest.skip(f"Postgres isn't reachable: {error}")
    register_vector(connection)
    with connection, connection.transaction(force_rollback=True):
        yield connection


def _axis_vector(axis: int, weight: float = 1.0) -> list[float]:
    """A vector pointing mostly along one axis (with a little of axis 0 so none are orthogonal)."""
    vector = [0.0] * DIMENSIONS
    vector[0] = 0.1
    vector[axis] = weight
    return vector


def _insert_user(connection: psycopg.Connection[DictRow]) -> UUID:
    """Inserts a user with a unique email and returns its id."""
    user_id = uuid4()
    connection.execute(
        "INSERT INTO users (id, email, created_at, updated_at) VALUES (%s, %s, now(), now())",
        [user_id, f"{user_id}@example.com"],
    )
    return user_id


def _insert_embedding(
    connection: psycopg.Connection[DictRow],
    user_id: UUID,
    content: str,
    vector: list[float],
    model: str = MODEL,
) -> UUID:
    """Inserts one skill embedding and returns its source id."""
    source_id = uuid4()
    connection.execute(
        """
        INSERT INTO library_embeddings (id, user_id, source_type, source_id, content,
            content_digest, model, embedding, created_at, updated_at)
        VALUES (%s, %s, 'Skill', %s, %s, 'digest', %s, %s, now(), now())
        """,
        [uuid4(), user_id, source_id, content, model, Vector(vector)],
    )
    return source_id


def test_returns_the_users_entries_nearest_first(
    admin_connection: psycopg.Connection[DictRow],
) -> None:
    """Entries come back by cosine distance when the query text matches the nearest row."""
    user_id = _insert_user(admin_connection)
    kubernetes_id = _insert_embedding(admin_connection, user_id, "Kubernetes", _axis_vector(1))
    _insert_embedding(admin_connection, user_id, "Docker", _axis_vector(2))
    _insert_embedding(admin_connection, user_id, "Ruby", _axis_vector(3))
    admin_connection.execute("SET LOCAL ROLE ai_reader")

    query = _axis_vector(1)
    query[2] = 0.3

    matches = search_career_library(
        admin_connection, user_id, query, "Kubernetes clusters", MODEL, limit=2
    )

    assert [match.content for match in matches] == ["Kubernetes", "Docker"]
    assert matches[0].source_id == str(kubernetes_id)
    assert matches[0].source_type == "Skill"
    assert matches[0].score > matches[1].score
    assert 0 <= matches[0].distance < matches[1].distance


def test_keyword_match_outranks_a_nearer_vector(
    admin_connection: psycopg.Connection[DictRow],
) -> None:
    """A row that uses the query's word ranks above a nearer row that does not."""
    user_id = _insert_user(admin_connection)
    ruby_id = _insert_embedding(admin_connection, user_id, "Ruby", _axis_vector(3))
    _insert_embedding(admin_connection, user_id, "Kubernetes", _axis_vector(1))
    _insert_embedding(admin_connection, user_id, "Docker", _axis_vector(2))
    admin_connection.execute("SET LOCAL ROLE ai_reader")

    matches = search_career_library(
        admin_connection, user_id, _axis_vector(1), "Ruby programming", MODEL, limit=2
    )

    assert matches[0].content == "Ruby"
    assert matches[0].source_id == str(ruby_id)
    assert matches[0].distance > matches[1].distance


def test_ignores_other_users_and_other_models(
    admin_connection: psycopg.Connection[DictRow],
) -> None:
    """Another user's entries and entries from a different embedding model never match."""
    user_id = _insert_user(admin_connection)
    other_user_id = _insert_user(admin_connection)
    _insert_embedding(admin_connection, user_id, "Mine", _axis_vector(2))
    _insert_embedding(admin_connection, other_user_id, "Theirs", _axis_vector(1))
    _insert_embedding(
        admin_connection, user_id, "Old model", _axis_vector(1), model="text-embedding-ada-002"
    )
    admin_connection.execute("SET LOCAL ROLE ai_reader")

    matches = search_career_library(admin_connection, user_id, _axis_vector(1), "Theirs", MODEL)

    assert [match.content for match in matches] == ["Mine"]
