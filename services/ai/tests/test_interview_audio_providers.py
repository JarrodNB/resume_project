"""Exercise bounded audio HTTP and durable dispatch without paid requests."""

import asyncio
import io
import json
import wave
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest

from interviews.audio_providers import AudioProviders, ProviderError
from interviews.client import Claim


def claim():
    return Claim(
        operation_id="op",
        kind="speech",
        attempt_id="attempt",
        claim_generation=1,
        execution_mode="real",
        execution_config={
            "transcription_model": "gpt-transcribe",
            "interviewer_model": "gpt-6-luna",
            "speech_model": "gpt-4o-mini-tts",
            "voice": "marin",
        },
        execution_deadline=datetime.now(UTC) + timedelta(seconds=120),
        lease_expires_at=datetime.now(UTC) + timedelta(seconds=30),
        payload={"text": "Saved reply", "message_id": "message"},
    )


def audio():
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b"\x01\x00" * 8000)
    return output.getvalue()


def test_transcription_registers_before_http_and_normalizes_duration():
    rails = AsyncMock()
    events = []
    rails.start_provider.side_effect = lambda *args: events.append("registered")

    def respond(request):
        assert events == ["registered"]
        assert request.url == "https://api.openai.com/v1/audio/transcriptions"
        assert b'name="model"\r\n\r\ngpt-transcribe' in request.content
        assert b'filename="recording.wav"' in request.content
        assert b"Content-Type: audio/wav" in request.content
        events.append("http")
        return httpx.Response(
            200,
            json={
                "text": "My answer",
                "languages": [{"code": "en"}],
                "usage": {"type": "duration", "seconds": 1},
            },
        )

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic", transport=httpx.MockTransport(respond)
        ) as provider:
            assert await provider.transcribe(claim(), audio()) == "My answer"

    asyncio.run(run())
    assert events == ["registered", "http"]
    assert rails.usage.call_args.args[1] == [{"audio_milliseconds": 1000, "cost_microdollars": 75}]
    assert not rails.usage.call_args.kwargs["incomplete"]


@pytest.mark.parametrize(
    "body",
    [
        b"{}",
        b"[]",
        b'{"usage":[]}',
        b"not-json",
        json.dumps({"text": "ok", "usage": {"type": "tokens", "input_tokens": 1}}).encode(),
    ],
)
def test_invalid_response_never_fabricates_success_or_zero(body):
    rails = AsyncMock()

    async def run():
        async with AudioProviders(
            rails,
            api_key="synthetic",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, content=body)),
        ) as provider:
            with pytest.raises(ProviderError):
                await provider.transcribe(claim(), audio())

    asyncio.run(run())
    assert rails.usage.call_args.args[1] == []
    assert rails.usage.call_args.kwargs["incomplete"]


def test_empty_language_or_blank_transcript_reports_known_cost_then_safe_outcome():
    for text, languages in [(" ", [{"code": "en"}]), ("hallucination", [])]:
        rails = AsyncMock()

        async def run(rails=rails, text=text, languages=languages):
            async with AudioProviders(
                rails,
                api_key="synthetic",
                transport=httpx.MockTransport(
                    lambda _: httpx.Response(
                        200,
                        json={
                            "text": text,
                            "languages": languages,
                            "usage": {"type": "duration", "seconds": 1},
                        },
                    )
                ),
            ) as provider:
                with pytest.raises(ProviderError, match="unusable_audio"):
                    await provider.transcribe(claim(), audio())

        asyncio.run(run())
        assert rails.usage.call_args.args[1][0]["cost_microdollars"] == 75


def test_no_dispatch_without_admission_and_no_retry_on_provider_failure():
    rails = AsyncMock()
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(503)

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic", transport=httpx.MockTransport(respond)
        ) as provider:
            rails.start_provider.side_effect = RuntimeError("admission failed")
            with pytest.raises(RuntimeError):
                await provider.transcribe(claim(), audio())
            assert not calls
            rails.start_provider.side_effect = None
            with pytest.raises(ProviderError):
                await provider.transcribe(claim(), audio())

    asyncio.run(run())
    assert len(calls) == 1
    assert rails.usage.call_args.kwargs["incomplete"]


def test_invalid_audio_never_reserves_or_dispatches():
    rails = AsyncMock()

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic", transport=httpx.MockTransport(lambda _: pytest.fail("HTTP"))
        ) as provider:
            with pytest.raises(ValueError):
                await provider.transcribe(claim(), b"invalid")

    asyncio.run(run())
    rails.start_provider.assert_not_called()


def speech_stream(data, usage=None):
    import base64

    events = [
        {"type": "speech.audio.delta", "audio": base64.b64encode(data).decode()},
        {
            "type": "speech.audio.done",
            "usage": usage or {"input_tokens": 14, "output_tokens": 101, "total_tokens": 115},
        },
    ]
    return "".join("data: " + json.dumps(event) + "\n\n" for event in events).encode()


def test_speech_speaks_exact_saved_text_and_accounts_sse_tokens():
    rails = AsyncMock()
    saved_text = "  My saved reply.\n"

    def respond(request):
        rails.start_provider.assert_awaited_once()
        assert json.loads(request.content) == {
            "model": "gpt-4o-mini-tts",
            "voice": "marin",
            "input": saved_text,
            "stream_format": "sse",
            "response_format": "wav",
        }
        return httpx.Response(200, content=speech_stream(audio()))

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic", transport=httpx.MockTransport(respond)
        ) as provider:
            assert await provider.speak(claim(), saved_text) == audio()

    asyncio.run(run())
    assert rails.usage.call_args.args[1] == [
        {"input_tokens": 14, "output_tokens": 101, "cost_microdollars": 1221}
    ]


def test_speech_without_terminal_usage_stays_unknown():
    rails = AsyncMock()

    async def run():
        async with AudioProviders(
            rails,
            api_key="synthetic",
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200, content=b'data: {"type":"speech.audio.delta","audio":"AA=="}\n\n'
                )
            ),
        ) as provider:
            with pytest.raises(ProviderError):
                await provider.speak(claim(), "Saved reply")

    asyncio.run(run())
    assert rails.usage.call_args.kwargs["incomplete"]


@pytest.mark.parametrize("partial_trailer", [b"", b"data: [DO", b": comment \xc3"])
def test_completed_speech_does_not_wait_for_http_eof_and_keeps_usage(partial_trailer):
    rails = AsyncMock()

    class CompletedStream(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            # Complete SSE is smaller than the previous 64 KiB read buffer.
            raw = (": café\n\n".encode() + speech_stream(audio()).replace(
                b', "usage":', b',\ndata: "usage":'
            )).replace(b"\n", b"\r\n")
            final_frame = raw.rfind(b"data: ")
            # Split a UTF-8 codepoint and a CRLF delimiter across reads.
            for start, end in [(0, 3), (3, final_frame - 3),
                               (final_frame - 3, final_frame - 2), (final_frame - 2, final_frame)]:
                yield raw[start:end]
            yield raw[final_frame:] + partial_trailer
            raise httpx.ReadTimeout("HTTP body stayed open after speech completed")

        async def aclose(self):
            self.closed = True

    stream = CompletedStream()

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream)),
        ) as provider:
            assert await provider.speak(claim(), "Saved reply") == audio()

    asyncio.run(run())
    assert stream.closed
    assert not rails.usage.call_args.kwargs["incomplete"]
    assert rails.usage.call_args.args[1][0]["cost_microdollars"] == 1221


@pytest.mark.parametrize("failure", ["headers_timeout", "body_timeout", "http_status"])
def test_audio_failure_diagnostics_are_content_free_and_keep_unknown_usage(caplog, failure):
    rails = AsyncMock()
    sensitive = "private-answer-and-secret-key"

    class BrokenStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b": provider heartbeat\n\n"
            raise httpx.ReadTimeout(sensitive)

    def respond(_request):
        if failure == "headers_timeout":
            raise httpx.ReadTimeout(sensitive)
        if failure == "body_timeout":
            return httpx.Response(200, stream=BrokenStream())
        return httpx.Response(503, text=sensitive, headers={"x-request-id": sensitive})

    async def run():
        async with AudioProviders(
            rails, api_key=sensitive, transport=httpx.MockTransport(respond),
        ) as provider:
            with pytest.raises(ProviderError, match="provider_unavailable"):
                await provider.speak(claim(), sensitive)

    asyncio.run(run())
    assert sensitive not in caplog.text
    assert "Interview audio request failed" in caplog.text
    assert "endpoint=speech" in caplog.text
    assert "elapsed_ms=" in caplog.text
    if failure == "headers_timeout":
        assert "phase=headers" in caplog.text and "error=ReadTimeout" in caplog.text
    elif failure == "body_timeout":
        assert "phase=body" in caplog.text and "received_bytes=22" in caplog.text
    else:
        assert "status=503" in caplog.text
    assert rails.usage.call_args.kwargs["incomplete"]


def test_speech_accepts_openai_done_sentinel_after_terminal_usage():
    rails = AsyncMock()

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic",
            transport=httpx.MockTransport(lambda _: httpx.Response(
                200, content=speech_stream(audio()) + b"data: [DONE]\n\n",
            )),
        ) as provider:
            assert await provider.speak(claim(), "Hello.") == audio()

    asyncio.run(run())
    assert rails.usage.call_args.args[1][0]["cost_microdollars"] == 1221
    assert not rails.usage.call_args.kwargs["incomplete"]


def test_live_streaming_wav_is_finalized_without_changing_samples():
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(b"\x01\x00" * 2400)
    expected = output.getvalue()
    streamed = expected[:4] + b"\xff" * 4 + expected[8:40] + b"\xff" * 4 + expected[44:]
    rails = AsyncMock()

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic",
            transport=httpx.MockTransport(lambda _: httpx.Response(
                200, content=speech_stream(streamed) + b"data: [DONE]\n\n",
            )),
        ) as provider:
            assert await provider.speak(claim(), "Hello.") == expected

    asyncio.run(run())
    assert not rails.usage.call_args.kwargs["incomplete"]


def test_streaming_wav_finalization_does_not_repair_other_or_partial_headers():
    malformed = audio()[:4] + b"\xff" * 4 + audio()[8:40] + b"\xff" * 4 + audio()[44:]
    assert AudioProviders._finalize_speech_wav(malformed) == malformed
    assert AudioProviders._finalize_speech_wav(b"RIFF") == b"RIFF"


def test_cancellation_keeps_unknown_and_invalid_speech_does_not_reserve():
    rails = AsyncMock()

    async def respond(_):
        raise asyncio.CancelledError

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic", transport=httpx.MockTransport(respond)
        ) as provider:
            with pytest.raises(ProviderError):
                await provider.speak(claim(), " ")
            rails.start_provider.assert_not_called()
            with pytest.raises(asyncio.CancelledError):
                await provider.speak(claim(), "Saved reply")

    asyncio.run(run())
    assert rails.usage.call_args.kwargs["incomplete"]


def test_expired_admitted_claim_never_dispatches_and_retains_unknown():
    rails = AsyncMock()
    expired = claim().model_copy(
        update={"execution_deadline": datetime.now(UTC) - timedelta(seconds=1)}
    )

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic", transport=httpx.MockTransport(lambda _: pytest.fail("HTTP"))
        ) as provider:
            with pytest.raises(TimeoutError):
                await provider.speak(expired, "Saved reply")

    asyncio.run(run())
    rails.start_provider.assert_awaited_once()
    assert rails.usage.call_args.kwargs["incomplete"]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(302, headers={"location": "https://other.test"}),
        httpx.Response(200, content=b"x" * 64_001),
        httpx.Response(200, headers={"content-encoding": "gzip"}),
    ],
)
def test_redirects_and_response_bounds_leave_unknown_without_retry(response):
    rails = AsyncMock()
    calls = []

    def respond(request):
        calls.append(request)
        return response

    async def run():
        async with AudioProviders(
            rails, api_key="synthetic", transport=httpx.MockTransport(respond)
        ) as provider:
            with pytest.raises(ProviderError):
                await provider.transcribe(claim(), audio())

    asyncio.run(run())
    assert len(calls) == 1
    assert rails.usage.call_args.kwargs["incomplete"]


@pytest.mark.parametrize(
    "raw",
    [
        b"data: nope\n\n",
        b"data: []\n\n",
        b'data: {"type":"speech.audio.done","usage":[]}\n\n',
        b'data: {"type":"speech.audio.delta","audio":"$$"}\n\n',
        speech_stream(audio(), {"input_tokens": True, "output_tokens": 1, "total_tokens": 2}),
        speech_stream(audio()) + b'data: {"type":"speech.audio.done"}\n\n',
        b"data: [DONE]\n\n",
        b"data: [DONE]\n\n" + speech_stream(audio()),
        speech_stream(audio()) + b"data: [DONE]\n\ndata: [DONE]\n\n",
        speech_stream(audio()) + b'data: [DONE]\n\ndata: {"type":"speech.audio.delta","audio":"AA=="}\n\n',
    ],
)
def test_malformed_sse_never_becomes_zero_usage(raw):
    rails = AsyncMock()

    async def run():
        async with AudioProviders(
            rails,
            api_key="synthetic",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, content=raw)),
        ) as provider:
            with pytest.raises(ProviderError):
                await provider.speak(claim(), "Saved reply")

    asyncio.run(run())
    assert rails.usage.call_args.args[1] == []
    assert rails.usage.call_args.kwargs["incomplete"]


def test_deadline_cancels_inflight_dispatch_without_hidden_retry():
    rails = AsyncMock()
    calls = []

    async def respond(request):
        calls.append(request)
        await asyncio.sleep(1)
        pytest.fail("deadline did not cancel HTTP")

    async def run():
        short = claim().model_copy(
            update={"execution_deadline": datetime.now(UTC) + timedelta(milliseconds=30)}
        )
        async with AudioProviders(
            rails, api_key="synthetic", transport=httpx.MockTransport(respond)
        ) as provider:
            with pytest.raises(TimeoutError):
                await provider.speak(short, "Saved reply")

    asyncio.run(run())
    assert len(calls) == 1
    assert rails.usage.call_args.kwargs["incomplete"]


def test_bad_generated_audio_keeps_actual_usage_without_playable_success():
    rails = AsyncMock()

    async def run():
        async with AudioProviders(
            rails,
            api_key="synthetic",
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, content=speech_stream(b"not audio"))
            ),
        ) as provider:
            with pytest.raises(ValueError):
                await provider.speak(claim(), "Saved reply")

    asyncio.run(run())
    assert not rails.usage.call_args.kwargs["incomplete"]


@pytest.mark.parametrize("ambiguous", [False, True])
def test_invalid_or_lost_rails_receipt_never_dispatches_audio(ambiguous):
    from interviews.client import RailsInterviewClient, RailsTransportError

    def receipt(request):
        if ambiguous:
            raise httpx.ReadTimeout("synthetic lost receipt")
        return httpx.Response(200, json={})

    async def run():
        async with RailsInterviewClient(
            "http://api:3000", "synthetic", transport=httpx.MockTransport(receipt)
        ) as rails, AudioProviders(
            rails,
            api_key="synthetic",
            transport=httpx.MockTransport(
                lambda _: pytest.fail("Provider dispatched without registration receipt")
            ),
        ) as provider:
            with pytest.raises(RailsTransportError):
                await provider.speak(claim(), "Saved reply")

    asyncio.run(run())
