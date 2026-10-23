"""
Description: Embeds a search query (e.g. a job requirement) with the same model Rails uses for the
career library, through Pydantic AI's Embedder so the call is traced like agent runs. Pair it with
database/library_embedding_search.py.
Index:
    - QueryEmbedding: the query vector plus the request's token usage (for cost reporting)
    - embed_search_query / embed_search_query_async: embed one query text
"""

from typing import NamedTuple

from pydantic_ai import Embedder
from pydantic_ai.embeddings import EmbeddingModel, EmbeddingSettings
from pydantic_ai.usage import RequestUsage

from worker.contact_mask import mask_outbound
from worker.task_usage import current_task_usage


class QueryEmbedding(NamedTuple):
    """One embedded query."""

    vector: list[float]
    usage: RequestUsage


def embed_search_query(text: str, model: EmbeddingModel | str, dimensions: int) -> QueryEmbedding:
    """Embeds `text` as a search query, with known contact replaced by the same placeholders
    Rails uses for library rows. Pass `WorkerSettings.embedding_model` and
    `embedding_dimensions` (tests pass a TestEmbeddingModel)."""
    import asyncio

    return asyncio.run(embed_search_query_async(text, model, dimensions))


async def embed_search_query_async(text: str, model: EmbeddingModel | str, dimensions: int) -> QueryEmbedding:
    """Embed within the caller's event loop, awaiting cancellation and retaining usage."""
    embedder = Embedder(model, settings=EmbeddingSettings(dimensions=dimensions))
    usage = current_task_usage()
    try:
        result = await embedder.embed_query(mask_outbound(text))
    except BaseException:
        if usage is not None:
            usage.incomplete = True
        raise
    if usage is not None:
        model_name = model if isinstance(model, str) else f"{model.system}:{model.model_name}"
        usage.record(model_name, result.usage)
    return QueryEmbedding(vector=list(result.embeddings[0]), usage=result.usage)
