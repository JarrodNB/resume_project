"""Exercise hybrid listing order and bounded queue input without provider requests."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from memory.rerank_job_listings import hybrid_listing_order
from schemas.job_listing_reranking import RerankListingsInput


@pytest.fixture
def task_dependencies(task_dependencies):
    """Provider tests use a fake catalogue; real ownership is verified with SQL."""
    from dataclasses import replace
    return replace(task_dependencies, read_reranking_input=lambda task: RerankListingsInput.model_validate(task.input))


def test_hybrid_combines_keyword_and_library_order():
    """A strong keyword hit can outrank the nearest semantic result."""
    nearest, keyword, other = [str(uuid4()) for _ in range(3)]
    listings = [(nearest, "Backend engineer"), (keyword, "Ruby engineer"), (other, "Marketing")]
    assert (
        hybrid_listing_order(listings, [(nearest, 0.9), (keyword, 0.8), (other, 0.1)], "Ruby")[0]
        == keyword
    )


def test_input_rejects_duplicate_ids_and_blank_keywords():
    item = {"id": str(uuid4()), "text": "Ruby engineer"}
    with pytest.raises(ValidationError):
        RerankListingsInput.model_validate({"keyword": "Ruby", "listings": [item, item]})
    with pytest.raises(ValidationError):
        RerankListingsInput.model_validate({"keyword": "  ", "listings": [item]})


def test_input_bounds_text_count_and_total_utf8_bytes():
    with pytest.raises(ValidationError):
        RerankListingsInput(keyword="Ruby", listings=[])
    with pytest.raises(ValidationError):
        RerankListingsInput(
            keyword="Ruby", listings=[{"id": uuid4(), "text": "x"} for _ in range(101)]
        )
    with pytest.raises(ValidationError):
        RerankListingsInput(keyword="Ruby", listings=[{"id": uuid4(), "text": "🦆" * 1501}])
    with pytest.raises(ValidationError):
        RerankListingsInput(
            keyword="Ruby", listings=[{"id": uuid4(), "text": "x" * 6000} for _ in range(40)]
        )


def test_hybrid_keeps_candidates_once_and_provider_order_for_equal_scores():
    ids = [str(uuid4()), str(uuid4())]
    listings = [(item, "unrelated") for item in ids]
    assert hybrid_listing_order(listings, [(item, 0.5) for item in ids], "Ruby") == ids
    with pytest.raises(ValueError):
        hybrid_listing_order(listings, [(ids[0], 0.5)], "Ruby")


def test_dispatch_reranks_with_one_batch_and_scopes_scorer_to_task_owner(
    monkeypatch, task_dependencies
):
    from dataclasses import replace

    from pydantic_ai import Embedder
    from pydantic_ai.embeddings import TestEmbeddingModel

    from llm.usage import collect_task_usage
    from worker.queue_messages import AiTaskMessage
    from worker.task_handlers import handle_ai_task

    ids = [str(uuid4()), str(uuid4())]
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="rerank_job_listings",
        input={
            "keyword": "Ruby",
            "listings": [
                {"id": ids[0], "text": "Backend engineer"},
                {"id": ids[1], "text": "Ruby engineer"},
            ],
        },
    )
    monkeypatch.setattr(
        "worker.rerank_job_listings_handler.Embedder",
        lambda *a, **kw: Embedder(TestEmbeddingModel(dimensions=16), settings=kw["settings"]),
    )
    calls = []

    def score(user_id, candidates, model):
        calls.append((user_id, candidates, model))
        return [(ids[0], 0.9), (ids[1], 0.8)]

    dependencies = replace(
        task_dependencies,
        score_job_listings=score,
        settings=task_dependencies.settings.model_copy(update={"embedding_dimensions": 16}),
    )
    with collect_task_usage() as usage:
        result = handle_ai_task(task, dependencies)
    assert result.status == "completed"
    assert result.result == {"ranked_listing_ids": [ids[1], ids[0]]}
    assert calls[0][0] == task.user_id
    assert [item[0] for item in calls[0][1]] == ids
    assert all(len(vector) == 16 for _, vector in calls[0][1])
    assert len(usage.entries) == 1 and usage.entries[0].input_tokens > 0
    assert not usage.incomplete


def test_missing_library_fails_without_an_order(monkeypatch, task_dependencies):
    from dataclasses import replace

    from pydantic_ai import Embedder
    from pydantic_ai.embeddings import TestEmbeddingModel

    from worker.queue_messages import AiTaskMessage
    from worker.task_handlers import handle_ai_task

    ids = [str(uuid4())]
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="rerank_job_listings",
        input={"keyword": "Ruby", "listings": [{"id": ids[0], "text": "Ruby engineer"}]},
    )
    monkeypatch.setattr(
        "worker.rerank_job_listings_handler.Embedder",
        lambda *a, **kw: Embedder(TestEmbeddingModel(dimensions=16)),
    )
    result = handle_ai_task(task, replace(task_dependencies, score_job_listings=lambda *_: []))
    assert result.status == "failed" and result.result is None
    assert "indexing" in result.error_message
    assert len(result.usage) == 1


def test_failed_embedding_marks_missing_usage(monkeypatch, task_dependencies):
    from dataclasses import replace

    from llm.usage import collect_task_usage
    from worker.queue_messages import AiTaskMessage
    from worker.task_handlers import handle_ai_task

    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="rerank_job_listings",
        input={"keyword": "Ruby", "listings": [{"id": str(uuid4()), "text": "Ruby"}]},
    )

    class BrokenEmbedder:
        async def embed_documents(self, *args):
            raise TimeoutError("provider timeout")

    monkeypatch.setattr(
        "worker.rerank_job_listings_handler.Embedder", lambda *a, **kw: BrokenEmbedder()
    )
    with collect_task_usage() as usage, pytest.raises(TimeoutError):
        handle_ai_task(task, replace(task_dependencies, score_job_listings=lambda *_: []))
    assert usage.incomplete


def test_request_limit_stops_before_embedding(monkeypatch, task_dependencies):
    from dataclasses import replace

    from pydantic_ai.exceptions import UsageLimitExceeded

    from worker.queue_messages import AiTaskMessage
    from worker.task_handlers import handle_ai_task

    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="rerank_job_listings",
        input={"keyword": "Ruby", "listings": [{"id": str(uuid4()), "text": "Ruby"}]},
    )
    monkeypatch.setattr(
        "worker.rerank_job_listings_handler.Embedder",
        lambda *a, **kw: pytest.fail("Provider constructed"),
    )
    settings = task_dependencies.settings.model_copy(update={"llm_request_limit": 0})
    with pytest.raises(UsageLimitExceeded):
        handle_ai_task(
            task, replace(task_dependencies, settings=settings, score_job_listings=lambda *_: [])
        )


def test_embedding_deadline_cancels_provider_and_marks_usage_incomplete(
    monkeypatch, task_dependencies
):
    import asyncio
    from dataclasses import replace

    from llm.usage import collect_task_usage
    from worker.queue_messages import AiTaskMessage
    from worker.task_handlers import handle_ai_task

    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="rerank_job_listings",
        input={"keyword": "Ruby", "listings": [{"id": str(uuid4()), "text": "Ruby"}]},
    )

    class SlowEmbedder:
        async def embed_documents(self, *args):
            await asyncio.Event().wait()

    monkeypatch.setattr(
        "worker.rerank_job_listings_handler.Embedder", lambda *a, **kw: SlowEmbedder()
    )
    settings = task_dependencies.settings.model_copy(update={"llm_run_timeout_seconds": 0.01})
    with collect_task_usage() as usage, pytest.raises(TimeoutError):
        handle_ai_task(
            task, replace(task_dependencies, settings=settings, score_job_listings=lambda *_: [])
        )
    assert usage.incomplete


def test_post_embedding_token_cap_retains_known_cost(monkeypatch, task_dependencies):
    from dataclasses import replace

    from pydantic_ai import Embedder
    from pydantic_ai.embeddings import TestEmbeddingModel
    from pydantic_ai.exceptions import UsageLimitExceeded

    from llm.usage import collect_task_usage
    from worker.queue_messages import AiTaskMessage
    from worker.task_handlers import handle_ai_task

    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="rerank_job_listings",
        input={
            "keyword": "Ruby",
            "listings": [{"id": str(uuid4()), "text": "Ruby engineer software developer"}],
        },
    )
    monkeypatch.setattr(
        "worker.rerank_job_listings_handler.Embedder",
        lambda *a, **kw: Embedder(TestEmbeddingModel(dimensions=16)),
    )
    settings = task_dependencies.settings.model_copy(update={"llm_total_tokens_limit": 1})
    with collect_task_usage() as usage, pytest.raises(UsageLimitExceeded):
        handle_ai_task(
            task, replace(task_dependencies, settings=settings, score_job_listings=lambda *_: [])
        )
    assert len(usage.entries) == 1 and usage.entries[0].input_tokens > 1
    assert not usage.incomplete


def test_input_byte_limit_matches_compact_rails_queue_encoding():
    """Whitespace added by Python serialization must not reject a valid Rails snapshot."""
    import json

    payload = {
        "keyword": "engineer",
        "listings": [
            {"id": str(uuid4()), "text": "x" * 836 + "\n" * 554}
            for _ in range(100)
        ],
    }
    payload["listings"][-1]["text"] = payload["listings"][-1]["text"][36:]
    assert len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()) == 199999
    assert len(json.dumps(payload, ensure_ascii=False).encode()) > 200000
    assert len(RerankListingsInput.model_validate(payload).listings) == 100


def test_missing_catalogue_fails_before_embedding(monkeypatch, task_dependencies):
    from dataclasses import replace

    from worker.queue_messages import AiTaskMessage
    from worker.task_handlers import handle_ai_task
    monkeypatch.setattr("worker.rerank_job_listings_handler.Embedder", lambda *a, **kw: pytest.fail("embedding missing catalogue"))
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="rerank_job_listings",
                         input={"keyword": "Ruby", "listing_ids": [str(uuid4())]})
    result = handle_ai_task(task, replace(task_dependencies, read_reranking_input=lambda _: None))
    assert result.status == "failed" and result.result is None
    assert not result.usage


@pytest.mark.parametrize("ids", [[], [uuid4()] * 2, [uuid4() for _ in range(101)]])
def test_command_rejects_invalid_selection(ids):
    from schemas.job_listing_reranking import RerankListingsCommand
    with pytest.raises(ValidationError):
        RerankListingsCommand(keyword="Ruby", listing_ids=ids)
