"""
Description: Tests embedding a search query with TestEmbeddingModel, never OpenAI.
Index:
    - test_embeds_one_query_with_the_requested_dimensions
"""

from pydantic_ai.embeddings import TestEmbeddingModel

from memory.embed_search_query import embed_search_query


def test_embeds_one_query_with_the_requested_dimensions() -> None:
    """One vector of the requested size comes back, with its usage."""
    result = embed_search_query("Kubernetes experience", TestEmbeddingModel(dimensions=16), 16)

    assert len(result.vector) == 16
    assert all(isinstance(value, float) for value in result.vector)
    assert result.usage.input_tokens > 0


def test_async_embedding_keeps_privacy_and_accounting() -> None:
    """The async provider path returns the same vector contract and attempt usage."""
    import asyncio

    from llm.usage import collect_task_usage
    from memory.embed_search_query import embed_search_query_async
    from privacy.contact_mask import contact_scope
    from privacy.known_contact import KnownContact

    async def run():
        model = TestEmbeddingModel(dimensions=16)
        with contact_scope(KnownContact.from_values(names=["Synthetic Person"])), collect_task_usage() as usage:
            result = await embed_search_query_async("Synthetic Person knows Kubernetes", model, 16)
            expected = await embed_search_query_async("«name» knows Kubernetes", model, 16)
        assert result.vector == expected.vector
        assert len(result.vector) == 16
        assert len(usage.entries) == 2
        assert usage.entries[0].input_tokens == result.usage.input_tokens
    asyncio.run(run())
