"""Launch the real lifespan with synthetic provider HTTP transports for local checks.

This test-only entrypoint requires synthetic credentials and never opens provider sockets.
Rails and private storage remain real services. Production endpoints stay fixed.
"""
import base64
import io
import json
import os
import wave
from contextvars import ContextVar

import httpx
import httpx2
import uvicorn
from pydantic_ai.models.wrapper import WrapperModel

from interviews import audio_providers, models
from interviews.real_app import app
from schemas.interview_setup import InterviewSetup

_preparation_setup = ContextVar("mock_preparation_setup", default=None)

if any(os.getenv(key) != "synthetic-offline" for key in ("OPENAI_API_KEY", "TYPESAFE_API_KEY")):
    raise RuntimeError("Mock runtime requires synthetic credentials")


def wav():
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b"\0\0" * 800)
    return output.getvalue()


def audio_response(request):
    if os.getenv("INTERVIEW_CHECK_AUDIO_FAILURE") == "true":
        return httpx.Response(503, json={"error": "synthetic outage"})
    if request.url.path.endswith("transcriptions"):
        return httpx.Response(200, json={"text": "I improved a scheduling tool and reduced the wait by fifteen minutes.",
            "usage": {"type": "duration", "seconds": 0.1}})
    payload = json.loads(request.content)
    assert payload["voice"] == "marin" and payload["input"] in {
        "Tell me about a time you helped a team solve a difficult problem.",
        "How did you measure the shorter wait?",
        "Thank you. This interview is complete.",
        *[question["content"] for question_format in ("mixed", "behavioral", "technical", "screening")
            for question in preparation(InterviewSetup(question_count=12, question_format=question_format))["questions"]],
    }
    events = [
        {"type": "speech.audio.delta", "audio": base64.b64encode(wav()).decode()},
        {"type": "speech.audio.done", "usage": {"input_tokens": 10, "output_tokens": 10, "total_tokens": 20}},
    ]
    return httpx.Response(200, text="".join("data: " + json.dumps(event) + "\n\n" for event in events))


def preparation(setup=None):
    """A complete synthetic plan, used only by the isolated HTTP verification runtime."""
    setup = setup or InterviewSetup(question_count=9)
    return {"role": {"title": "Fictional scheduling coordinator",
        "responsibilities": ["Improve team scheduling"], "requirements": ["Explain scheduling decisions"]},
        "questions": [{"question_type": kind, "content": f"Question {index + 1}: explain a scheduling {kind} example."}
                      for index, kind in enumerate(setup.question_types())]}


def reasoning_response(request):
    payload = json.loads(request.content)
    tool = next(tool for tool in payload["tools"]
                if {"decision", "role"} & tool.get("parameters", {}).get("properties", {}).keys())
    result = preparation(_preparation_setup.get()) if "role" in tool["parameters"]["properties"] else {
        "decision": "continue", "reply": "How did you measure the shorter wait?"}
    return httpx.Response(200, json={"id": "resp_synthetic", "object": "response", "created_at": 1,
        "status": "completed", "model": "gpt-6-luna",
        "output": [{"type": "function_call", "id": "fc_synthetic", "call_id": "call_synthetic",
                    "name": tool["name"], "arguments": json.dumps(result)}],
        "usage": {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120}})


def screening_response(request):
    payload = json.loads(request.content)
    return httpx2.Response(200, json={"model": "jev-1.13.0",
        "usage": {"input_tokens": 100, "output_tokens": 0},
        "answers": {key: {"type": "noul", "noul": 0.01} for key in payload["questions"]}})


class MockAudio(audio_providers.AudioProviders):
    def __init__(self, rails, **kwargs):
        super().__init__(rails, **kwargs, transport=httpx.MockTransport(audio_response))
        self.failed_once = False

    async def speak(self, claim, text):
        data = await super().speak(claim, text)
        if (os.getenv("INTERVIEW_CHECK_SPEECH_FAILURE") == "true"
                and text == "How did you measure the shorter wait?" and not self.failed_once):
            self.failed_once = True
            # Known charged speech result followed by a local delivery failure.
            # Manual recovery must regenerate only this saved message.
            raise audio_providers.ProviderError("speech_failed")
        return data


class SavedPreparationModel(WrapperModel):
    """Scope synthetic output to the current claim without sharing choices across tasks."""

    def __init__(self, wrapped, setup):
        super().__init__(wrapped)
        self.setup = setup

    async def request(self, messages, settings, model_request_parameters):
        token = _preparation_setup.set(self.setup)
        try:
            return await self.wrapped.request(messages, settings, model_request_parameters)
        finally:
            _preparation_setup.reset(token)


class MockModels(models.InterviewModels):
    def __init__(self, **kwargs):
        super().__init__(**kwargs, openai_transport=httpx.MockTransport(reasoning_response),
                         typesafe_transport=httpx2.MockTransport(screening_response))

    def accounted(self, rails, claim, stage, model):
        accounted = super().accounted(rails, claim, stage, model)
        return SavedPreparationModel(accounted, claim.payload.setup) if claim.kind == "preparation" else accounted


def install_mock_providers():
    """Install HTTP-only substitutes in this explicitly synthetic process."""
    audio_providers.AudioProviders = MockAudio
    models.InterviewModels = MockModels

if __name__ == "__main__":
    install_mock_providers()
    uvicorn.run(app, host="0.0.0.0", port=8000, access_log=False)
