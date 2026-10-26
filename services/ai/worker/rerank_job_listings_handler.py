"""Rerank loaded job excerpts with keyword search and existing career-library vectors.

Only the listing excerpts are embedded. No text is sent to a generative model,
and no qualifications, career facts or public catalogue data are written here.
"""

import asyncio

from pydantic import ValidationError
from pydantic_ai import Embedder
from pydantic_ai.embeddings import EmbeddingSettings
from pydantic_ai.usage import RunUsage

from memory.rerank_job_listings import hybrid_listing_order
from schemas.job_listing_reranking import RankedListings, RerankListingsInput
from screening.session import remaining_timeout
from worker.contact_mask import mask_outbound
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage
from worker.run_limits import agent_usage_limits
from worker.task_usage import current_task_usage


async def _embed_listings(texts, settings):
    """Bound one batch request and retain its usage before checking post-call token caps."""
    usage = current_task_usage()
    limits = agent_usage_limits(settings)
    limits.check_before_request(RunUsage())
    embedder = Embedder(
        settings.embedding_model,
        settings=EmbeddingSettings(dimensions=settings.embedding_dimensions),
    )
    try:
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            result = await embedder.embed_documents([mask_outbound(text) for text in texts])
    except BaseException:
        if usage is not None:
            usage.incomplete = True
        raise
    if usage is not None:
        usage.record(settings.embedding_model, result.usage)
    tokens = RunUsage(requests=1)
    tokens.incr(result.usage)
    limits.check_tokens(tokens)
    return result


def handle_rerank_job_listings_task(task, dependencies):
    """Return an exact candidate permutation or a clear unavailable-library failure."""
    try:
        snapshot = RerankListingsInput.model_validate(task.input)
    except ValidationError:
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="Reranking needs a search keyword and 1 to 100 valid loaded roles.",
        )
    if dependencies.score_job_listings is None:
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="Career-library reranking is unavailable. Please try again later.",
        )
    embedded = asyncio.run(
        _embed_listings([item.text for item in snapshot.listings], dependencies.settings)
    )
    usage = [build_model_usage(dependencies.settings.embedding_model, embedded.usage)]
    if len(embedded.embeddings) != len(snapshot.listings):
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            usage=usage,
            error_message="The embedding provider returned an incomplete ranking. Please retry.",
        )
    candidates = [
        (str(item.id), list(vector))
        for item, vector in zip(snapshot.listings, embedded.embeddings, strict=True)
    ]
    similarities = dependencies.score_job_listings(
        task.user_id, candidates, dependencies.settings.embedding_model
    )
    if not similarities:
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            usage=usage,
            error_message="Add career-library details and let them finish indexing before reranking.",
        )
    ordered = hybrid_listing_order(
        [(str(item.id), item.text) for item in snapshot.listings], similarities, snapshot.keyword
    )
    return AiResultMessage(
        ai_task_id=task.ai_task_id,
        status="completed",
        usage=usage,
        result=RankedListings(ranked_listing_ids=ordered).model_dump(mode="json"),
    )
