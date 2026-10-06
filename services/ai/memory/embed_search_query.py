"""
Description: Embeds a search query (e.g. a job requirement) with the same model Rails uses for the
career library, through Pydantic AI's Embedder so the call is traced like agent runs. Pair it with
database/library_embedding_search.py.
Index:
    - QueryEmbedding: the query vector plus the request's token usage (for cost reporting)
    - embed_search_query: embeds one query text
    - stored_embedding_model_name: the model name as Rails stores it in library_embeddings
"""

from typing import NamedTuple

from pydantic_ai import Embedder
from pydantic_ai.embeddings import EmbeddingModel, EmbeddingSettings
from pydantic_ai.usage import RequestUsage

from worker.contact_mask import mask_outbound


class QueryEmbedding(NamedTuple):
    """One embedded query."""

    vector: list[float]
    usage: RequestUsage


def embed_search_query(text: str, model: EmbeddingModel | str, dimensions: int) -> QueryEmbedding:
    """Embeds `text` as a search query, with known contact replaced by the same placeholders
    Rails uses for library rows. Pass `WorkerSettings.embedding_model` and
    `embedding_dimensions` (tests pass a TestEmbeddingModel)."""
    embedder = Embedder(model, settings=EmbeddingSettings(dimensions=dimensions))
    result = embedder.embed_query_sync(mask_outbound(text))
    return QueryEmbedding(vector=list(result.embeddings[0]), usage=result.usage)


def stored_embedding_model_name(model: str) -> str:
    """Drops the provider prefix ("openai:text-embedding-3-small" -> "text-embedding-3-small"),
    matching the `model` column Rails writes."""
    return model.split(":", 1)[-1]
