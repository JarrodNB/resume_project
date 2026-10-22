"""Keep the offline process provider capable of preparing a complete real-path session."""
import asyncio
import importlib
import json

import httpx
import pytest
from pydantic_ai import models

from interviews.client import Claim
from interviews.real import RealInterviewExecutor
from schemas.interview_preparation import InterviewPreparation
from tests.test_interview_preparation import PreparationClient, preparation_claim


def test_mock_provider_returns_complete_preparation_for_preparer_tool(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-offline")
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic-offline")
    runtime = importlib.import_module("scripts.interview_mock_runtime")
    request = httpx.Request("POST", "https://api.openai.com/v1/responses", json={"tools": [
        {"name": "final_result", "parameters": {"properties": {"role": {}, "questions": {}}}}
    ]})
    response = runtime.reasoning_response(request)
    result = InterviewPreparation.model_validate(json.loads(response.json()["output"][0]["arguments"]))
    assert len(result.questions) == 9
    for question in result.questions:
        speech = runtime.audio_response(httpx.Request("POST", "https://api.openai.com/v1/audio/speech",
            json={"voice": "marin", "input": question.content}))
        assert speech.status_code == 200


@pytest.mark.parametrize("count", [5, 8, 12])
@pytest.mark.parametrize("question_format,cycle", [("mixed", ["behavioral", "technical", "knowledge"]),
    ("behavioral", ["behavioral"]), ("technical", ["technical", "knowledge"]), ("screening", ["screening"])])
def test_mock_provider_follows_saved_setup_through_real_executor(monkeypatch, count, question_format, cycle):
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-offline")
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic-offline")
    runtime = importlib.import_module("scripts.interview_mock_runtime")
    raw = preparation_claim().model_dump(mode="json")
    raw["payload"]["setup"] = {"question_count": count, "question_format": question_format}
    client = PreparationClient()

    async def execute():
        async with runtime.MockModels(openai_key="synthetic-offline", typesafe_key="synthetic-offline") as providers:
            with models.override_allow_model_requests(True), httpx.Client(
                transport=httpx.MockTransport(lambda request: pytest.fail("Preparation needs no storage"))) as storage:
                executor = RealInterviewExecutor(client, audio=None, models=providers,
                    storage_client=storage, allowed_origins=set())
                await executor.execute(Claim.model_validate(raw))

    asyncio.run(execute())
    assert not client.failed
    questions = client.accepted[0]["questions"]
    assert [question["question_type"] for question in questions] == [cycle[i % len(cycle)] for i in range(count)]
    for question in questions:
        assert runtime.audio_response(httpx.Request("POST", "https://api.openai.com/v1/audio/speech",
            json={"voice": "marin", "input": question["content"]})).status_code == 200
