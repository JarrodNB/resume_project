"""Keep the offline process provider capable of preparing a complete real-path session."""
import importlib
import json

import httpx

from schemas.interview_preparation import InterviewPreparation


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
