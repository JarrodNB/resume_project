"""
Description: Invalid library-search scopes fail before touching the database.
Index:
    - test_rejects_invalid_source_types: empty, malformed, and unknown scopes fail closed
    - test_requires_source_types: callers cannot silently search every type
    - test_tailoring_passes_explicit_scope: task identity and selected types reach search
"""

from contextlib import nullcontext
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic_ai.usage import RequestUsage

from database.library_embedding_search import search_career_library
from memory.embed_search_query import QueryEmbedding
from schemas.gap_analysis_context import JobToAnalyze
from tailoring.retrieve_for_section import retrieve_source_keys
from worker.settings import WorkerSettings


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


def test_tailoring_passes_explicit_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tailoring chooses its mixed library scope in code and retains the no-results fallback."""
    user_id = uuid4()
    connection = Mock()
    search = Mock(return_value=[])
    monkeypatch.setattr("tailoring.retrieve_for_section.search_career_library", search)
    monkeypatch.setattr(
        "tailoring.retrieve_for_section.open_read_only_connection",
        Mock(return_value=nullcontext(connection)),
    )
    monkeypatch.setattr(
        "tailoring.retrieve_for_section.embed_search_query",
        Mock(return_value=QueryEmbedding([0.1], RequestUsage())),
    )
    job = JobToAnalyze(id=str(uuid4()), title="Engineer", company="Example")

    keys, _usage = retrieve_source_keys(user_id, "experience", job, WorkerSettings())

    assert keys is None
    assert search.call_args.args[1] == user_id
    assert search.call_args.kwargs["source_types"] == {
        "Experience",
        "ExperienceHighlight",
        "Project",
        "Education",
        "Certification",
        "Skill",
        "LibraryFact",
    }


def test_requires_source_types() -> None:
    """Omitting the scope cannot become an unrestricted search."""
    connection = Mock()
    with pytest.raises(TypeError, match="source_types"):
        search_career_library(connection, uuid4(), [0.1], "Ruby", "model")
    assert connection.mock_calls == []


def test_async_tailoring_retains_user_scope_and_empty_search_fallback(monkeypatch):
    """Awaited query embedding keeps search filters identical to the synchronous path."""
    import asyncio
    from unittest.mock import AsyncMock

    from tailoring.retrieve_for_section import retrieve_source_keys_async

    user = uuid4()
    search = Mock(return_value=[])
    monkeypatch.setattr("tailoring.retrieve_for_section.search_career_library", search)
    monkeypatch.setattr("tailoring.retrieve_for_section.open_read_only_connection", Mock(return_value=nullcontext(Mock())))
    embed = AsyncMock(return_value=QueryEmbedding([0.1], RequestUsage(input_tokens=3)))
    monkeypatch.setattr("memory.embed_search_query.embed_search_query_async", embed)
    settings = WorkerSettings()
    job = JobToAnalyze(id=str(uuid4()), title="Engineer", company="Example")
    keys, usage = asyncio.run(retrieve_source_keys_async(user, "experience", job, settings))
    assert keys is None
    assert usage.input_tokens == 3
    assert search.call_args.args[1] == user
    assert search.call_args.kwargs["source_types"] == {
        "Experience", "ExperienceHighlight", "Project", "Education", "Certification", "Skill", "LibraryFact"}
    assert embed.await_count == 1


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
