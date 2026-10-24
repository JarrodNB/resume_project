"""Validate private interview audio before a provider sees it.

Storage access is limited to URLs supplied by Rails and exact configured origins.
No bucket credentials are used. Local decoding has byte, duration, and time bounds.
Download deadlines are checked on each received chunk without an extra fill buffer.
"""

import base64
import hashlib
import hmac
import json
import math
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx


class MediaError(ValueError):
    """Audio or its storage capability cannot be safely used.

    The stable code selects recovery behavior; the existing message stays useful
    to local callers without exposing storage URLs or provider errors.
    """

    def __init__(self, message: str, *, code: str = "invalid_recording"):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class MediaLimits:
    """Hard input and decoding limits, configurable by the runtime."""

    max_bytes: int = 10 * 1024 * 1024
    max_duration_seconds: float = 120
    subprocess_timeout_seconds: float = 15

    def __post_init__(self):
        if (
            not 0 < self.max_bytes <= 10 * 1024 * 1024
            or not 0 < self.max_duration_seconds <= 120
            or not 0 < self.subprocess_timeout_seconds <= 60
        ):
            raise ValueError("Invalid media limits")


@dataclass(frozen=True)
class AudioInfo:
    """Facts measured from actual audio, never browser metadata."""

    duration_seconds: float
    container: str


DEFAULT_LIMITS = MediaLimits()


def _run(command: list[str], limits: MediaLimits) -> bytes:
    try:
        result = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=limits.subprocess_timeout_seconds,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MediaError("Audio validation unavailable or timed out") from error
    if result.returncode or result.stderr:
        # Never include raw decoder errors, URLs, or audio in user-visible errors.
        raise MediaError("Invalid or incomplete audio")
    return result.stdout


def validate_audio(data: bytes, *, limits: MediaLimits = DEFAULT_LIMITS) -> AudioInfo:
    """Check the container and fully decode bounded audio; reject truncated input."""
    if not data:
        raise MediaError("Audio is empty or exceeds the byte limit", code="empty_audio")
    if len(data) > limits.max_bytes:
        raise MediaError("Audio is empty or exceeds the byte limit", code="audio_too_large")
    with tempfile.TemporaryDirectory(prefix="interview-audio-") as directory:
        source = Path(directory) / "input"
        decoded = Path(directory) / "decoded.pcm"
        source.write_bytes(data)
        raw = _run(
            [
                "ffprobe",
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "wav,matroska,webm,ogg,mp3,mov",
                "-show_entries",
                "format=format_name,duration:stream=codec_type",
                "-of",
                "json",
                str(source),
            ],
            limits,
        )
        try:
            probe = json.loads(raw)
            container = probe["format"]["format_name"]
            duration = float(probe["format"].get("duration", "nan"))
            streams = probe["streams"]
        except (ValueError, KeyError, TypeError) as error:
            raise MediaError("Invalid audio metadata") from error
        if (
            container not in {"wav", "matroska,webm", "ogg", "mp3", "mov,mp4,m4a,3gp,3g2,mj2"}
            or not streams
            or any(s.get("codec_type") != "audio" for s in streams)
        ):
            raise MediaError("Unsupported audio container or duration")
        if math.isfinite(duration) and duration > limits.max_duration_seconds:
            raise MediaError("Unsupported audio container or duration", code="audio_too_long")
        _run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-xerror",
                "-nostdin",
                "-threads",
                "1",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "wav,matroska,webm,ogg,mp3,mov",
                "-i",
                str(source),
                "-map",
                "0:a:0",
                "-t",
                str(limits.max_duration_seconds + 0.1),
                "-ac",
                "1",
                "-ar",
                "8000",
                "-f",
                "s16le",
                str(decoded),
            ],
            limits,
        )
        duration = decoded.stat().st_size / 16000
        if not 0 < duration <= limits.max_duration_seconds:
            raise MediaError(
                "Audio is empty or exceeds the duration limit",
                code="empty_audio" if duration <= 0 else "audio_too_long",
            )
        return AudioInfo(duration_seconds=duration, container=container)


def _check_url(url: str, allowed_origins: set[str], allow_http: bool) -> None:
    parsed = urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if (
        parsed.scheme not in ({"https", "http"} if allow_http else {"https"})
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or origin not in allowed_origins
    ):
        raise MediaError("Unapproved media capability")


def _check_client(client: httpx.Client) -> None:
    if (
        client.auth is not None
        or client.cookies
        or "authorization" in client.headers
        or "cookie" in client.headers
    ):
        raise MediaError("Storage client must not carry application credentials")


def download_audio(
    url: str,
    *,
    client: httpx.Client,
    allowed_origins: set[str],
    limits: MediaLimits = DEFAULT_LIMITS,
    allow_http: bool = False,
    expected_checksum: str | None = None,
    expected_byte_size: int | None = None,
) -> bytes:
    """Download at most the byte cap, without redirects, then validate actual audio.

    Enable HTTP only for explicitly configured development storage origins. The
    client must not carry application authentication; storage URLs authenticate themselves.
    """
    _check_url(url, allowed_origins, allow_http)
    _check_client(client)
    deadline = time.monotonic() + 15
    try:
        with client.stream("GET", url, follow_redirects=False, timeout=15) as response:
            if response.status_code != 200:
                raise MediaError("Media download failed", code="storage_unavailable")
            if response.headers.get("content-encoding", "identity") != "identity":
                raise MediaError("Compressed storage responses are unsupported")
            data = bytearray()
            for chunk in response.iter_bytes():
                if time.monotonic() > deadline:
                    raise MediaError("Media download timed out", code="storage_unavailable")
                if len(data) + len(chunk) > limits.max_bytes:
                    raise MediaError("Audio exceeds the byte limit", code="audio_too_large")
                data.extend(chunk)
    except httpx.HTTPError:
        raise MediaError("Media download failed", code="storage_unavailable") from None
    result = bytes(data)
    if expected_byte_size is not None and len(result) != expected_byte_size:
        raise MediaError("Audio does not match the reserved byte size")
    if expected_checksum is not None:
        checksum = base64.b64encode(hashlib.md5(result, usedforsecurity=False).digest()).decode()
        if not hmac.compare_digest(checksum, expected_checksum):
            raise MediaError("Audio does not match the reserved checksum")
    validate_audio(result, limits=limits)
    return result


def upload_audio(
    url: str,
    data: bytes,
    *,
    client: httpx.Client,
    allowed_origins: set[str],
    content_type: str,
    limits: MediaLimits = DEFAULT_LIMITS,
    allow_http: bool = False,
    headers: dict[str, str] | None = None,
) -> None:
    """PUT validated speech to one Rails-issued capability, without bucket access."""
    _check_url(url, allowed_origins, allow_http)
    _check_client(client)
    validate_audio(data, limits=limits)
    upload_headers = {"Content-Type": content_type}
    for key, value in (headers or {}).items():
        if key.lower() not in {"content-type", "content-md5"}:
            raise MediaError("Unsupported storage header")
        upload_headers[key] = value
    try:
        response = client.put(
            url,
            content=data,
            headers=upload_headers,
            follow_redirects=False,
            timeout=15,
        )
        if not 200 <= response.status_code < 300:
            raise MediaError("Media upload failed", code="storage_unavailable")
    except httpx.HTTPError:
        raise MediaError("Media upload failed", code="storage_unavailable") from None
