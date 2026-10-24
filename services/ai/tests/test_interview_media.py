"""Exercise real encoded audio and bounded, narrowly authorized media transfers."""

import io
import wave

import httpx
import pytest

from interviews.media import MediaError, MediaLimits, download_audio, upload_audio, validate_audio


def wav_bytes(seconds=0.1):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\0\0" * int(8000 * seconds))
    return output.getvalue()


def test_decodes_actual_audio_despite_filename_or_declared_type():
    result = validate_audio(wav_bytes())
    assert result.duration_seconds == pytest.approx(0.1)
    assert result.container == "wav"


@pytest.mark.parametrize("data", [b"", b"not audio", wav_bytes()[:60], wav_bytes(0)])
def test_rejects_empty_malformed_and_truncated_audio(data):
    with pytest.raises(MediaError):
        validate_audio(data)


def test_limits_actual_duration_and_size():
    with pytest.raises(MediaError):
        validate_audio(wav_bytes(), limits=MediaLimits(max_bytes=100))
    with pytest.raises(MediaError):
        validate_audio(wav_bytes(0.2), limits=MediaLimits(max_duration_seconds=0.1))


def test_download_validates_and_upload_only_uses_supplied_capability():
    requests = []

    def serve(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, content=wav_bytes())
        return httpx.Response(200)

    with httpx.Client(transport=httpx.MockTransport(serve)) as client:
        data = download_audio(
            "https://media.test/input?signature=secret",
            client=client,
            allowed_origins={"https://media.test"},
        )
        upload_audio(
            "https://media.test/output?signature=secret",
            data,
            client=client,
            allowed_origins={"https://media.test"},
            content_type="audio/wav",
        )
    assert [r.method for r in requests] == ["GET", "PUT"]
    assert requests[1].content == data
    assert "authorization" not in requests[0].headers


@pytest.mark.parametrize(
    "url", ["http://media.test/a", "https://other.test/a", "https://user:password@media.test/a"]
)
def test_rejects_unapproved_capability_origins_before_request(url):
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _: pytest.fail("made request"))
        ) as client,
        pytest.raises(MediaError),
    ):
        download_audio(url, client=client, allowed_origins={"https://media.test"})


def test_download_rejects_oversized_body_and_redirect_without_following():
    for response in [
        httpx.Response(200, content=b"x" * 101),
        httpx.Response(302, headers={"Location": "https://other.test/a"}),
    ]:
        with (
            httpx.Client(
                transport=httpx.MockTransport(lambda _, response=response: response)
            ) as client,
            pytest.raises(MediaError),
        ):
            download_audio(
                "https://media.test/a",
                client=client,
                allowed_origins={"https://media.test"},
                limits=MediaLimits(max_bytes=100),
            )


def test_download_deadline_interrupts_trickling_body(monkeypatch):
    """Small chunks must not defer the total deadline until a large buffer fills."""
    now = 0
    received = 0
    closed = False

    class TricklingBody(httpx.SyncByteStream):
        def __iter__(self):
            nonlocal now, received
            for _ in range(100):
                now += 1
                received += 1
                yield b"x"

        def close(self):
            nonlocal closed
            closed = True

    monkeypatch.setattr("interviews.media.time.monotonic", lambda: now)
    with (
        httpx.Client(transport=httpx.MockTransport(
            lambda _: httpx.Response(200, stream=TricklingBody())
        )) as client,
        pytest.raises(MediaError, match="timed out") as failure,
    ):
        download_audio(
            "https://media.test/audio", client=client, allowed_origins={"https://media.test"}
        )

    assert received <= 16
    assert closed
    assert failure.value.code == "storage_unavailable"


@pytest.mark.parametrize(
    "container,codec",
    [("webm", "libopus"), ("ogg", "libopus"), ("mp3", "libmp3lame"), ("mp4", "aac")],
)
def test_browser_audio_containers_decode(container, codec):
    import subprocess

    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.2",
            "-c:a",
            codec,
            "-f",
            container,
            *(["-movflags", "frag_keyframe+empty_moov"] if container == "mp4" else []),
            "pipe:1",
        ],
        capture_output=True,
        check=True,
        timeout=10,
    )
    assert 0 < validate_audio(result.stdout).duration_seconds < 1


def test_decoder_timeout_is_bounded_and_does_not_expose_details(monkeypatch):
    import subprocess

    def timeout(command, **kwargs):
        assert kwargs["timeout"] == 0.01
        raise subprocess.TimeoutExpired(command, 0.01)

    monkeypatch.setattr(subprocess, "run", timeout)
    with pytest.raises(MediaError, match="timed out"):
        validate_audio(wav_bytes(), limits=MediaLimits(subprocess_timeout_seconds=0.01))


def test_rejects_client_application_credentials():
    with (
        httpx.Client(
            headers={"Authorization": "Bearer private"},
            transport=httpx.MockTransport(lambda _: pytest.fail("made request")),
        ) as client,
        pytest.raises(MediaError, match="credentials"),
    ):
        download_audio(
            "https://media.test/a", client=client, allowed_origins={"https://media.test"}
        )


@pytest.mark.parametrize(
    "expectations", [{"expected_checksum": "wrong"}, {"expected_byte_size": 100}]
)
def test_download_rejects_mismatched_reserved_identity(expectations):
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, content=wav_bytes()))
        ) as client,
        pytest.raises(MediaError, match="reserved"),
    ):
        download_audio(
            "https://media.test/a",
            client=client,
            allowed_origins={"https://media.test"},
            **expectations,
        )


def test_upload_rejects_broad_headers():
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _: pytest.fail("made request"))
        ) as client,
        pytest.raises(MediaError, match="header"),
    ):
        upload_audio(
            "https://media.test/a",
            wav_bytes(),
            client=client,
            allowed_origins={"https://media.test"},
            content_type="audio/wav",
            headers={"Authorization": "Bearer private"},
        )


@pytest.mark.parametrize(
    "data,limits,code",
    [
        (b"", MediaLimits(), "empty_audio"),
        (wav_bytes(0), MediaLimits(), "empty_audio"),
        (wav_bytes(), MediaLimits(max_bytes=100), "audio_too_large"),
        (wav_bytes(0.2), MediaLimits(max_duration_seconds=0.1), "audio_too_long"),
        (b"not audio", MediaLimits(), "invalid_recording"),
    ],
)
def test_validation_returns_distinct_safe_failure_codes(data, limits, code):
    with pytest.raises(MediaError) as failure:
        validate_audio(data, limits=limits)
    assert failure.value.code == code


@pytest.mark.parametrize("method", ["download", "upload"])
def test_storage_failures_are_retryable_without_exposing_private_errors(method):
    def unavailable(_):
        raise httpx.ReadTimeout("https://storage/private?secret=token")

    with (
        httpx.Client(transport=httpx.MockTransport(unavailable)) as client,
        pytest.raises(MediaError) as failure,
    ):
        if method == "download":
            download_audio(
                "https://media.test/audio",
                client=client,
                allowed_origins={"https://media.test"},
            )
        else:
            upload_audio(
                "https://media.test/audio",
                wav_bytes(),
                client=client,
                allowed_origins={"https://media.test"},
                content_type="audio/wav",
            )
    assert failure.value.code == "storage_unavailable"
    assert "secret" not in str(failure.value)


def test_unsafe_origin_keeps_terminal_code_and_existing_error_message():
    with (
        httpx.Client() as client,
        pytest.raises(MediaError, match="Unapproved media capability") as failure,
    ):
        download_audio(
            "https://evil.test/audio", client=client, allowed_origins={"https://media.test"}
        )
    assert failure.value.code == "invalid_recording"
    assert MediaError("Existing message").code == "invalid_recording"
