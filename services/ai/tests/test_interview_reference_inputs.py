"""Verify preparation skips every classifier and source text stays outside execution claims."""

import pytest
from pydantic import ValidationError

from interviews.client import ReferencePayload
from tests.test_interview_preparation import Models, preparation_claim, run


@pytest.mark.parametrize("extra", [{"sources": ["private"]}, {"recent_questions": ["private question?"]}])
def test_reference_payload_rejects_saved_source_text(extra):
    with pytest.raises(ValidationError):
        ReferencePayload(
            version=1,
            user_id="owner",
            interview_id="interview",
            setup={"question_count": 8},
            **extra,
        )


def test_preparation_does_not_screen_unknown_sources_or_focus(monkeypatch):
    request = preparation_claim()
    models = Models(blocked=True)
    client = run(models, request)
    assert not client.failed
    assert client.accepted
    assert {item[0] for item in models.requests} == {"gpt-6-luna"}
    assert not any(call[0] in {"screen_library", "screen_focus"} for call in client.calls)


@pytest.mark.parametrize("failure,retryable", [("stale", False), ("database", True)])
def test_reference_load_failure_stops_before_any_provider(failure, retryable):
    import asyncio

    import psycopg

    from interviews.real import RealInterviewExecutor
    from tests.test_interview_preparation import PreparationClient

    request = preparation_claim()
    request = request.model_copy(
        update={
            "payload": ReferencePayload(
                version=1, user_id="owner", interview_id="interview", setup=request.payload.setup
            )
        }
    )

    def load(_):
        raise (
            psycopg.OperationalError("database unavailable")
            if failure == "database"
            else ValueError("stale claim")
        )

    client, models = PreparationClient(), Models()
    executor = RealInterviewExecutor(
        client,
        audio=None,
        models=models,
        storage_client=None,
        allowed_origins=set(),
        input_reader=load,
    )
    asyncio.run(executor.execute(request))
    assert client.failed == [
        ("dependency_unavailable" if retryable else "execution_failed", retryable)
    ]
    assert not models.requests and not client.accepted


def test_reference_preparation_is_loaded_once_before_masked_execution():
    import asyncio

    from interviews.real import RealInterviewExecutor
    from tests.test_interview_preparation import PreparationClient

    hydrated = preparation_claim()
    hydrated.payload.preparation_context["recent_questions"] = ["Previously prepared main question?"]
    reference = hydrated.model_copy(
        update={
            "payload": ReferencePayload(
                version=1, user_id="owner", interview_id="interview", setup=hydrated.payload.setup
            )
        }
    )
    reads = []

    def load(claim):
        reads.append(claim.operation_id)
        return hydrated

    client, models = PreparationClient(), Models(blocked=True)
    executor = RealInterviewExecutor(
        client,
        audio=None,
        models=models,
        storage_client=None,
        allowed_origins=set(),
        input_reader=load,
    )
    asyncio.run(executor.execute(reference))
    assert reads == [reference.operation_id]
    assert "Previously prepared main question?" in models.requests[-1][1]
    assert client.accepted and not client.failed
    assert {item[0] for item in models.requests} == {"gpt-6-luna"}


def test_real_turn_does_not_return_saved_dialogue_as_model_history():
    from tests.test_interview_conversation import prepared_claim
    from tests.test_interview_executor import Client
    from tests.test_real_interview_executor import Models as TurnModels
    from tests.test_real_interview_executor import run as run_turn

    client, models = Client(), TurnModels()
    request = prepared_claim(
        dialogue=[{"kind": "opening", "content": "Previously saved question marker?"}]
    )
    run_turn(client, models, request)
    assert client.accepted and not client.failed
    assert "Previously saved question marker?" in models.prompts[-1][1]
    assert "model_history" not in client.accepted[0]


def test_fixture_turn_returns_only_new_output_and_uses_public_dialogue():
    from tests.test_interview_executor import Client, claim, execute

    request = claim()
    request.payload.current_dialogue = []
    client = Client()
    execute(client, request)
    assert not client.failed


def test_fixture_uses_owned_public_dialogue_as_history(monkeypatch):
    from types import SimpleNamespace

    from interviews.client import PublicMessage
    from interviews.executor import InterviewExecutor
    from tests.test_interview_executor import Client, claim, execute

    captured = []
    original = InterviewExecutor._interviewer
    def interviewer(self, request, guard):
        agent, options = original(self, request, guard)
        async def run(prompt, **kwargs):
            captured.append((prompt, kwargs["message_history"]))
            return await agent.run(prompt, **kwargs)
        return SimpleNamespace(run=run), options
    monkeypatch.setattr(InterviewExecutor, "_interviewer", interviewer)
    request = claim()
    request.payload.current_dialogue = [PublicMessage(kind=kind, content=text) for kind, text in [
        ("opening", "Saved opening?"), ("answer", "The exact earlier answer."), ("follow_up", "Saved follow-up?")]]
    client = Client()
    execute(client, request)
    assert not client.failed

    prompt, history = captured[0]
    assert "The exact earlier answer." in str(history)
    assert "Saved follow-up?" in str(history)
    assert "never use this copied source" not in str(history)
    assert '"fixture_context"' not in str(history)
    assert prompt.startswith("<candidate_answer>")
