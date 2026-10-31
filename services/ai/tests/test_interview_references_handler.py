"""Career references are claimed once and return only saved user evidence."""
from dataclasses import replace
from uuid import UUID, uuid4

import httpx
import pytest

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def reference_task():
    return AiTaskMessage(ai_task_id=UUID(int=1), user_id=UUID(int=2), task_type="interview_references",
        input={"reference_id": str(UUID(int=3)), "question_text": "Describe your Kubernetes work."})


def claimed_dependencies(task_dependencies, allowed=True, canonical_task=None):
    def grant(request):
        task = canonical_task or reference_task()
        return httpx.Response(200, json={"allowed": allowed,
            "question_text": "Describe your Kubernetes work.",
            "query_text": task.input.get("query_text", task.input["question_text"]),
            "user_id": str(task.user_id), "reference_id": task.input["reference_id"]})
    return replace(task_dependencies,
        settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test"}),
        http_client=httpx.Client(transport=httpx.MockTransport(grant)))


def test_denied_reference_claim_does_no_search(task_dependencies):
    result = handle_ai_task(reference_task(), claimed_dependencies(task_dependencies, False))
    assert result.status == "usage"
    assert result.result is None and not result.usage


@pytest.mark.parametrize(("min_similarity", "expected_count"), [(.65, 1), (.9, 0)])
def test_claimed_search_returns_exact_saved_context_without_requirement(task_dependencies, monkeypatch, min_similarity, expected_count):
    from contextlib import nullcontext
    from unittest.mock import Mock

    from pydantic_ai.usage import RequestUsage

    from memory.embed_search_query import QueryEmbedding
    from schemas.gap_analysis_context import CareerContext, CareerLibrary
    from schemas.library_search_match import LibrarySearchMatch

    source_id = str(uuid4())
    library = CareerLibrary(career_contexts=[CareerContext(id=source_id, requirement="REQUIREMENT NOT EVIDENCE",
        response="I maintained Kubernetes clusters.\nExact saved detail.")])
    deps = replace(claimed_dependencies(task_dependencies),
        settings=task_dependencies.settings.model_copy(update={"interview_service_secret": "test",
            "interview_reference_min_similarity": min_similarity}), read_career_library=lambda _: library)
    # These are true external seams: embeddings and database I/O. Saved evidence projection is real.
    async def embed(*args):
        return QueryEmbedding([1.0], RequestUsage(input_tokens=8))
    monkeypatch.setattr("interviews.references.embed_search_query_async", embed)
    monkeypatch.setattr("interviews.references.open_read_only_connection", lambda _: nullcontext(object()))
    search = Mock(return_value=[LibrarySearchMatch(source_type="CareerContext", source_id=source_id,
        content="Fact: REQUIREMENT NOT EVIDENCE: I maintained Kubernetes clusters.\nExact saved detail.", distance=0.2, score=0.03)])
    monkeypatch.setattr("interviews.references.search_career_library", search)
    task = reference_task()
    result = handle_ai_task(task, deps)
    assert result.status == "completed"
    assert result.result == {"selection_policy_version": "interview-references-v5", "references": [{"source_type": "CareerContext", "source_id": source_id,
        "title": "Saved career context", "body": library.career_contexts[0].response}][:expected_count]}
    assert result.usage[0].input_tokens == 8
    assert search.call_args.args[1] == task.user_id
    assert "CareerContext" in search.call_args.kwargs["source_types"]
    assert "Skill" not in search.call_args.kwargs["source_types"]


def test_mismatched_prompt_never_searches(task_dependencies):
    task = reference_task()
    task.input["question_text"] = "Changed question"
    result = handle_ai_task(task, replace(claimed_dependencies(task_dependencies), read_interview_auxiliary=unavailable_context))
    assert result.status == "failed"
    assert result.result is None and not result.usage


def test_extra_context_is_rejected_before_claim(task_dependencies):
    from pydantic import ValidationError
    task = reference_task()
    task.input["draft_answer"] = "PRIVATE"
    with pytest.raises(ValidationError):
        handle_ai_task(task, task_dependencies)


def test_empty_library_does_not_embed(task_dependencies):
    from schemas.gap_analysis_context import CareerLibrary
    deps = replace(claimed_dependencies(task_dependencies), read_career_library=lambda _: CareerLibrary())
    result = handle_ai_task(reference_task(), deps)
    assert result.status == "completed" and result.result == {"selection_policy_version": "interview-references-v5", "references": []}
    assert result.usage == []


def test_skills_only_library_does_not_embed_or_search(task_dependencies, monkeypatch):
    from unittest.mock import Mock

    from schemas.gap_analysis_context import CareerLibrary, LibrarySkill

    embed = Mock(side_effect=AssertionError("must not embed"))
    search = Mock(side_effect=AssertionError("must not search"))
    monkeypatch.setattr("interviews.references.embed_search_query_async", embed)
    monkeypatch.setattr("interviews.references.search_career_library", search)
    library = CareerLibrary(skills=[LibrarySkill(id=str(uuid4()), name="Kubernetes")])
    deps = replace(claimed_dependencies(task_dependencies), read_career_library=lambda _: library)
    result = handle_ai_task(reference_task(), deps)
    assert result.status == "completed"
    assert result.result == {"selection_policy_version": "interview-references-v5", "references": []}
    assert result.usage == []
    embed.assert_not_called()
    search.assert_not_called()


def test_sources_project_exact_bodies_and_exclude_summary():
    from interviews.references import saved_reference_sources
    from schemas.gap_analysis_context import (
        CareerLibrary,
        LibraryExperience,
        LibraryHighlight,
        LibraryProject,
    )
    role_id, highlight_id, project_id = [str(uuid4()) for _ in range(3)]
    library = CareerLibrary(summary="Summary is not indexed", experiences=[LibraryExperience(id=role_id,
        company="Acme", title="Engineer", description="Built systems", highlights=[LibraryHighlight(id=highlight_id,
        content="  Exact saved bullet\nwith whitespace  ")])], projects=[LibraryProject(id=project_id,
        name="Search", description="X" * 4001)])
    sources = saved_reference_sources(library)
    assert len(sources) == 2
    assert sources[("ExperienceHighlight", highlight_id)].body == "  Exact saved bullet\nwith whitespace  "
    assert sources[("Experience", role_id)].title == "Engineer at Acme"


def test_denied_delivery_finalizes_zero_cost(task_dependencies):
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message
    from worker.queue_messages import AiResultMessage
    queue = FakeResultQueue()
    assert process_task_message(reference_task().model_dump_json(), 2, queue, claimed_dependencies(task_dependencies, False))
    marker, final = [AiResultMessage.model_validate_json(body) for body in queue.sent_bodies]
    assert marker.attempt_id == final.attempt_id
    assert marker.attempt_finished is False and final.attempt_finished is True
    assert final.status == "usage" and not final.usage_incomplete and final.usage == []


def test_claimed_failure_requires_explicit_retry(task_dependencies, monkeypatch):
    from schemas.gap_analysis_context import CareerLibrary
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message
    from worker.queue_messages import AiResultMessage
    def fail(*args):
        raise TimeoutError("private provider error")
    monkeypatch.setattr("worker.interview_references_handler.retrieve_references", fail)
    deps = replace(claimed_dependencies(task_dependencies), read_career_library=lambda _: CareerLibrary())
    queue = FakeResultQueue()
    assert process_task_message(reference_task().model_dump_json(), 1, queue, deps)
    final = AiResultMessage.model_validate_json(queue.sent_bodies[-1])
    assert final.status == "failed" and final.attempt_finished is True
    assert final.error_message == "The AI task failed"


def test_embedding_charge_survives_later_search_failure(task_dependencies, monkeypatch):
    from contextlib import nullcontext

    from pydantic_ai.embeddings import TestEmbeddingModel

    from memory.embed_search_query import embed_search_query_async
    from schemas.gap_analysis_context import CareerContext, CareerLibrary
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message
    from worker.queue_messages import AiResultMessage

    async def embed(text, _model, dimensions):
        return await embed_search_query_async(text, TestEmbeddingModel(
            model_name="text-embedding-3-small", provider_name="openai"), dimensions)
    monkeypatch.setattr("interviews.references.embed_search_query_async", embed)
    monkeypatch.setattr("interviews.references.open_read_only_connection", lambda _: nullcontext(object()))
    def search(*args, **kwargs):
        raise TimeoutError("database search timeout")
    monkeypatch.setattr("interviews.references.search_career_library", search)
    library = CareerLibrary(career_contexts=[CareerContext(id=str(uuid4()), requirement="Kubernetes", response="Maintained clusters")])
    deps = replace(claimed_dependencies(task_dependencies), read_career_library=lambda _: library)
    queue = FakeResultQueue()
    assert process_task_message(reference_task().model_dump_json(), 1, queue, deps)
    final = AiResultMessage.model_validate_json(queue.sent_bodies[-1])
    assert final.status == "failed" and len(final.usage) == 1
    assert final.usage[0].model == "openai:text-embedding-3-small"
    assert final.usage[0].input_tokens > 0 and not final.usage_incomplete


def test_claim_identity_mismatch_cannot_read_another_users_library(task_dependencies):
    from unittest.mock import Mock
    task = reference_task()
    task.user_id = uuid4()
    reader = Mock(side_effect=AssertionError('must not read'))
    deps = replace(claimed_dependencies(task_dependencies), read_career_library=reader, read_interview_auxiliary=unavailable_context)
    result = handle_ai_task(task, deps)
    assert result.status == 'failed'
    reader.assert_not_called()


def test_reference_identity_mismatch_cannot_start_embedding(task_dependencies):
    from unittest.mock import Mock
    task = reference_task()
    task.input['reference_id'] = str(uuid4())
    reader = Mock(side_effect=AssertionError('must not read'))
    result = handle_ai_task(task, replace(claimed_dependencies(task_dependencies), read_career_library=reader, read_interview_auxiliary=unavailable_context))
    assert result.status == 'failed'
    reader.assert_not_called()


def test_follow_up_uses_exact_rails_granted_query(task_dependencies, monkeypatch):
    from unittest.mock import Mock

    from schemas.gap_analysis_context import CareerLibrary
    task = reference_task()
    task.input["query_text"] = "Main question\n\nI migrated Kubernetes\n\nWhat changed afterward?"
    retrieve = Mock(return_value=([], None))
    monkeypatch.setattr("worker.interview_references_handler.retrieve_references", retrieve)
    deps = replace(claimed_dependencies(task_dependencies, canonical_task=task),
                   read_career_library=lambda _: CareerLibrary())
    assert handle_ai_task(task, deps).status == "completed"
    assert retrieve.call_args.args[1] == task.input["query_text"]


@pytest.fixture
def task_dependencies(task_dependencies):
    # Unit tests isolate canonical reads; DB tests exercise the production adapter.
    return replace(task_dependencies, read_interview_auxiliary=lambda task, grant: grant)


def unavailable_context(task, grant):
    raise ValueError("Saved claim no longer matches")
