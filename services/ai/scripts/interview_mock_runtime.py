"""Launch the real lifespan with synthetic provider HTTP transports for local checks.

This test-only entrypoint requires synthetic credentials and never opens provider sockets.
Rails and private storage remain real services. Production endpoints stay fixed.
"""
import base64
import io
import json
import os
import wave

import httpx
import httpx2
import uvicorn

from interviews import audio_providers, models
from interviews.real_app import app

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
    if request.url.path.endswith("transcriptions"):
        return httpx.Response(200, json={"text": "I improved a scheduling tool and reduced the wait by fifteen minutes.",
            "usage": {"type": "duration", "seconds": 0.1}})
    payload = json.loads(request.content)
    assert payload["voice"] == "marin" and payload["input"] in {
        "Tell me about a time you helped a team solve a difficult problem.",
        "How did you measure the shorter wait?",
        "Thank you. This interview is complete.",
    }
    events = [
        {"type": "speech.audio.delta", "audio": base64.b64encode(wav()).decode()},
        {"type": "speech.audio.done", "usage": {"input_tokens": 10, "output_tokens": 10, "total_tokens": 20}},
    ]
    return httpx.Response(200, text="".join("data: " + json.dumps(event) + "\n\n" for event in events))


def reasoning_response(request):
    payload = json.loads(request.content)
    tool = next(tool["name"] for tool in payload["tools"] if "decision" in tool.get("parameters", {}).get("properties", {}))
    return httpx.Response(200, json={"id": "resp_synthetic", "object": "response", "created_at": 1,
        "status": "completed", "model": "gpt-6-luna",
        "output": [{"type": "function_call", "id": "fc_synthetic", "call_id": "call_synthetic",
                    "name": tool, "arguments": json.dumps({"decision": "continue", "reply": "How did you measure the shorter wait?"})}],
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
        if text == "How did you measure the shorter wait?" and not self.failed_once:
            self.failed_once = True
            # Known charged speech result followed by a local delivery failure.
            # Manual recovery must regenerate only this saved message.
            raise audio_providers.ProviderError("speech_failed")
        return data


class MockModels(models.InterviewModels):
    def __init__(self, **kwargs):
        super().__init__(**kwargs, openai_transport=httpx.MockTransport(reasoning_response),
                         typesafe_transport=httpx2.MockTransport(screening_response))


audio_providers.AudioProviders = MockAudio
models.InterviewModels = MockModels

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, access_log=False)
