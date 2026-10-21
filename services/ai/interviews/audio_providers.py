"""Convert bounded interview audio and saved text through admitted OpenAI HTTP.

These adapters only transcribe or speak; Pydantic AI owns dialogue reasoning.
Provider responses have byte and wall-clock bounds, fixed endpoints and no retries.
No response bodies, recording contents or credentials are logged.
"""

import asyncio
import base64
import binascii
import json
import math
import struct
from decimal import ROUND_CEILING, Decimal

import httpx

from interviews.media import validate_audio
from interviews.provider_calls import ProviderCalls


class ProviderError(ValueError):
    """A safe stable failure code, without sensitive provider response details."""


class AudioProviders:
    """Audio transformations usable only after Rails grants each dispatch."""

    def __init__(self, rails, *, api_key: str, transport=None):
        if not api_key or any(character in api_key for character in "\r\n"):
            raise ValueError("Missing provider credential")
        self._calls = ProviderCalls(rails)
        self._http = httpx.AsyncClient(
            transport=transport or httpx.AsyncHTTPTransport(retries=0),
            timeout=httpx.Timeout(30, connect=5),
            follow_redirects=False,
            trust_env=False,
            headers={"Authorization": f"Bearer {api_key}", "Accept-Encoding": "identity"},
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self._http.aclose()

    async def _request(self, endpoint, *, limit: int, **kwargs) -> bytes:
        try:
            async with asyncio.timeout(40):
                async with self._http.stream(
                    "POST", "https://api.openai.com/v1/audio/" + endpoint, **kwargs
                ) as response:
                    if response.status_code != 200:
                        raise ProviderError("provider_unavailable")
                    if response.headers.get("content-encoding", "identity") != "identity":
                        raise ProviderError("invalid_provider_response")
                    data = bytearray()
                    async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                        if len(data) + len(chunk) > limit:
                            raise ProviderError("provider_response_too_large")
                        data.extend(chunk)
                    return bytes(data)
        except (httpx.HTTPError, TimeoutError):
            raise ProviderError("provider_unavailable") from None

    async def transcribe(self, claim, data: bytes) -> str:
        """Validate actual bytes, send one multipart recording, return usable text.

        gpt-transcribe duration usage is priced at $0.0045/minute. Missing or
        unsupported usage never becomes a zero-cost report or a successful answer.
        """
        info = await asyncio.to_thread(validate_audio, data)
        filename, content_type = {
            "wav": ("recording.wav", "audio/wav"),
            "matroska,webm": ("recording.webm", "audio/webm"),
            "ogg": ("recording.ogg", "audio/ogg"),
            "mp3": ("recording.mp3", "audio/mpeg"),
            "mov,mp4,m4a,3gp,3g2,mj2": ("recording.m4a", "audio/mp4"),
        }[info.container]

        async def dispatch():
            raw = await self._request(
                "transcriptions",
                limit=64_000,
                data={"model": "gpt-transcribe", "response_format": "json"},
                files={"file": (filename, data, content_type)},
            )
            try:
                payload = json.loads(raw)
                usage = payload["usage"]
                seconds = usage["seconds"]
                if (
                    usage["type"] != "duration"
                    or isinstance(seconds, bool)
                    or not isinstance(seconds, (int, float))
                    or not math.isfinite(seconds)
                    or not 0 < seconds <= 120
                ):
                    raise ValueError
                milliseconds = int(
                    (Decimal(str(seconds)) * 1000).to_integral_value(rounding=ROUND_CEILING)
                )
                cost = int((Decimal(str(seconds)) * 75).to_integral_value(rounding=ROUND_CEILING))
                entries = [{"audio_milliseconds": milliseconds, "cost_microdollars": cost}]
                # Preserve known cost even if the transcript proves unusable.
                return payload, entries
            except (ValueError, KeyError, TypeError):
                raise ProviderError("invalid_provider_response") from None

        payload = await self._calls.run(
            claim, "transcription", "openai", "gpt-transcribe", dispatch
        )
        text = payload.get("text")
        if not isinstance(text, str) or len(text) > 4_000:
            raise ProviderError("invalid_provider_response")
        languages = payload.get("languages")
        if languages is not None and (
            not isinstance(languages, list)
            or any(
                not isinstance(language, dict)
                or not isinstance(language.get("code"), str)
                or not language["code"]
                for language in languages
            )
        ):
            raise ProviderError("invalid_provider_response")
        if not text.strip() or languages == []:
            raise ProviderError("unusable_audio")
        return text

    async def speak(self, claim, text: str) -> bytes:
        """Speak exactly saved text, with token usage from the terminal SSE event.

        Rails reserves a human-approved conservative estimate, not a guaranteed
        provider billing ceiling. A timeout or truncated stream blocks subsequent
        paid verification until known charges can be reconciled.
        """
        if not isinstance(text, str) or not text.strip() or len(text) > 4_000:
            raise ProviderError("invalid_speech_text")

        async def dispatch():
            raw = await self._request(
                "speech",
                limit=14 * 1024 * 1024,
                json={
                    "model": "gpt-4o-mini-tts",
                    "voice": "marin",
                    "input": text,
                    "stream_format": "sse",
                    "response_format": "wav",
                },
            )
            return self._speech_result(raw)

        data = await self._calls.run(claim, "speech", "openai", "gpt-4o-mini-tts", dispatch)
        data = self._finalize_speech_wav(data)
        await asyncio.to_thread(validate_audio, data)
        return data

    @staticmethod
    def _finalize_speech_wav(data: bytes) -> bytes:
        """Seal the provider's streamed PCM WAV after terminal usage was verified.

        Streaming WAV has unknown RIFF/data lengths (0xffffffff). Our saved file
        needs actual lengths for strict decoding. Recognize only the observed
        24 kHz, mono, 16-bit PCM header; all other files retain strict validation.
        Never apply this to user recordings or incomplete provider streams.
        """
        header = (
            b"RIFF\xff\xff\xff\xffWAVEfmt \x10\x00\x00\x00"
            b"\x01\x00\x01\x00\xc0\x5d\x00\x00\x80\xbb\x00\x00"
            b"\x02\x00\x10\x00data\xff\xff\xff\xff"
        )
        if data.startswith(header) and len(data) > 44 and (len(data) - 44) % 2 == 0:
            return (data[:4] + struct.pack("<I", len(data) - 8) + data[8:40]
                    + struct.pack("<I", len(data) - 44) + data[44:])
        return data

    @staticmethod
    def _speech_result(raw):
        audio = bytearray()
        usage = None
        stream_done = False
        try:
            # A finite complete response is parsed after bounded download. SSE data
            # fields may span lines; comments and event labels carry no payload.
            for block in raw.decode("utf-8").replace("\r\n", "\n").split("\n\n"):
                fields = [
                    line[5:].lstrip(" ") for line in block.splitlines() if line.startswith("data:")
                ]
                if not fields:
                    continue
                if stream_done:
                    raise ValueError("Data after stream terminator")
                payload = "\n".join(fields)
                # The live API sends this non-JSON transport sentinel after the
                # speech.audio.done usage event. It supplies no usage itself.
                if payload == "[DONE]":
                    if usage is None:
                        raise ValueError("Stream ended before terminal usage")
                    stream_done = True
                    continue
                event = json.loads(payload)
                if usage is not None:
                    raise ValueError("Data after terminal event")
                if event["type"] == "speech.audio.delta":
                    audio.extend(base64.b64decode(event["audio"], validate=True))
                    if len(audio) > 10 * 1024 * 1024:
                        raise ValueError("Oversized audio")
                elif event["type"] == "speech.audio.done":
                    usage = event["usage"]
                    values = [
                        usage[key] for key in ("input_tokens", "output_tokens", "total_tokens")
                    ]
                    if (
                        any(
                            type(value) is not int or not 0 < value <= 1_000_000_000
                            for value in values
                        )
                        or values[0] + values[1] != values[2]
                    ):
                        raise ValueError("Invalid usage")
                else:
                    raise ValueError("Unsupported event")
            if usage is None:
                raise ValueError("Missing terminal usage")
            # Rates are dollars per million tokens, equivalently microdollars per
            # token: text input 0.60, generated audio output 12.00. Round upward.
            cost = int(
                (
                    Decimal(usage["input_tokens"]) * Decimal("0.6")
                    + Decimal(usage["output_tokens"]) * 12
                ).to_integral_value(rounding=ROUND_CEILING)
            )
            return bytes(audio), [
                {
                    "input_tokens": usage["input_tokens"],
                    "output_tokens": usage["output_tokens"],
                    "cost_microdollars": cost,
                }
            ]
        except (ValueError, KeyError, TypeError, binascii.Error):
            raise ProviderError("invalid_provider_response") from None
