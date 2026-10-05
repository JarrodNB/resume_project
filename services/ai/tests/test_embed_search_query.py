"""
Description: Tests for embedding a search query (on TestEmbeddingModel, never OpenAI) and for the
model name stored by Rails.
Index:
    - test_embeds_one_query_with_the_requested_dimensions
    - test_stored_model_name_drops_the_provider_prefix
"""

from pydantic_ai.embeddings import TestEmbeddingModel

from memory.embed_search_query import embed_search_query, stored_embedding_model_name
from worker.settings import WorkerSettings


def test_embeds_one_query_with_the_requested_dimensions() -> None:
    """One vector of the requested size comes back, with its usage."""
    result = embed_search_query("Kubernetes experience", TestEmbeddingModel(dimensions=16), 16)

    assert len(result.vector) == 16
    assert all(isinstance(value, float) for value in result.vector)
    assert result.usage.input_tokens > 0


def test_stored_model_name_drops_the_provider_prefix() -> None:
    """The worker's model setting maps to the name Rails writes in library_embeddings.model."""
    assert stored_embedding_model_name(WorkerSettings().embedding_model) == "text-embedding-3-small"
    assert stored_embedding_model_name("text-embedding-3-small") == "text-embedding-3-small"
