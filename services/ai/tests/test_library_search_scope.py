"""
Description: Invalid library-search scopes fail before touching the database.
Index:
    - test_rejects_invalid_source_types: empty, malformed, and unknown scopes fail closed
    - test_requires_source_types: callers cannot silently search every type
"""

from contextlib import nullcontext
from unittest.mock import Mock
from uuid import uuid4

import pytest

from database.library_embedding_search import search_career_library


@pytest.mark.parametrize(
    "source_types", [set(), {"InterviewQuestion"}, {"Skill", "invalid"}, "Skill", None]
)
def test_rejects_invalid_source_types(source_types: object) -> None:
    """Bad scopes raise before opening a cursor or registering database types."""
    connection = Mock()
    with pytest.raises(ValueError, match="source_types"):
        search_career_library(
            connection, uuid4(), [0.1], "Ruby", "model", source_types=source_types
        )
    assert connection.mock_calls == []


def test_requires_source_types() -> None:
    """Omitting the scope cannot become an unrestricted search."""
    connection = Mock()
    with pytest.raises(TypeError, match="source_types"):
        search_career_library(connection, uuid4(), [0.1], "Ruby", "model")
    assert connection.mock_calls == []


@pytest.mark.parametrize("model", ["openai:text-embedding-3-small", "text-embedding-3-small"])
def test_search_owns_stored_model_representation(monkeypatch, model):
    """Callers pass configured models without knowing Rails' storage representation."""
    cursor = Mock()
    cursor.execute.return_value = cursor
    cursor.fetchall.return_value = []
    connection = Mock()
    connection.transaction.return_value = nullcontext()
    connection.cursor.return_value = nullcontext(cursor)
    monkeypatch.setattr("database.library_embedding_search.register_vector", lambda _connection: None)
    user_id = uuid4()

    assert search_career_library(
        connection, user_id, [0.1], "Ruby", model, source_types={"Skill"}
    ) == []
    params = cursor.execute.call_args.args[1]
    assert params["model"] == "text-embedding-3-small"
    assert params["user_id"] == user_id
    assert params["source_types"] == ["Skill"]


def test_search_preserves_row_metadata_after_hybrid_ranking(monkeypatch):
    """Same IDs in different source types remain distinct through the ranking adapter."""
    cursor = Mock()
    cursor.execute.return_value = cursor
    cursor.fetchall.return_value = [
        {"source_type": "Skill", "source_id": "shared", "content": "Compliance", "distance": 0.1},
        {"source_type": "Project", "source_id": "shared", "content": "Terraform", "distance": 0.4},
    ]
    connection = Mock()
    connection.transaction.return_value = nullcontext()
    connection.cursor.return_value = nullcontext(cursor)
    monkeypatch.setattr("database.library_embedding_search.register_vector", lambda _connection: None)

    results = search_career_library(
        connection, uuid4(), [0.1], "Terraform", "model", source_types={"Skill", "Project"}
    )
    assert [(match.source_type, match.source_id, match.content, match.distance) for match in results] == [
        ("Project", "shared", "Terraform", 0.4), ("Skill", "shared", "Compliance", 0.1),
    ]
    assert results[0].score > results[1].score
