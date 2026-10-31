"""Verify preparation skips every classifier and source text stays outside execution claims."""

import pytest
from pydantic import ValidationError

from interviews.client import ReferencePayload
from tests.test_interview_preparation import Models, preparation_claim, run


def test_reference_payload_rejects_saved_source_text():
    with pytest.raises(ValidationError):
        ReferencePayload(
            version=1,
            user_id="owner",
            interview_id="interview",
            setup={"question_count": 8},
            sources=["private"],
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
    assert client.accepted[0]["history_version"] == 1
    assert client.accepted[0]["model_history"] == []
