"""Exercise local prompt injection screening through the public screening interface."""

import asyncio
from contextlib import nullcontext
from itertools import pairwise
from types import SimpleNamespace

from screening import local_llama
from screening.screen_user_text import screen_user_text, screen_user_text_async
from screening.session import screening_session


def test_local_screen_checks_a_long_tail_without_provider_usage(monkeypatch):
    seen = []
    monkeypatch.setattr(local_llama, "_model_pair", lambda: (lambda text, **kwargs: {"input_ids": text}, None))

    def classify(chunk, model, timeout):
        seen.append(chunk)
        return SimpleNamespace(blocked="attack" in chunk, tokens=len(chunk), duration=0.01)

    monkeypatch.setattr("screening.local_llama.classify_chunk", classify)
    result = screen_user_text("x" * 3500 + "attack", "meta-llama/Llama-Prompt-Guard-2-22M", 10)
    assert result.allowed is False
    assert result.model_usages == []
    assert len(seen) > 1
    assert "".join(seen).count("attack") >= 1


def test_local_screen_fails_closed_on_classifier_error(monkeypatch):
    monkeypatch.setattr(local_llama, "_model_pair", lambda: (lambda text, **kwargs: {"input_ids": text}, None))
    def classify(*args):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr("screening.local_llama.classify_chunk", classify)
    result = screen_user_text("ordinary career history", "meta-llama/Llama-Prompt-Guard-2-22M", 10)
    assert result.allowed is False
    assert result.unchecked is True


def test_local_allow_is_reused_within_a_screening_session(monkeypatch):
    monkeypatch.setattr(local_llama, "_model_pair", lambda: (lambda text, **kwargs: {"input_ids": text}, None))
    calls = []

    def classify(chunk, model, timeout):
        calls.append(chunk)
        return SimpleNamespace(blocked=False, tokens=len(chunk), duration=0.01)

    monkeypatch.setattr(local_llama, "classify_chunk", classify)
    with screening_session(10):
        first = screen_user_text("Ordinary experience", local_llama.MODEL, 10)
        second = screen_user_text("Ordinary experience", local_llama.MODEL, 10)
    assert first.allowed and second.allowed
    assert len(calls) == 1


def test_async_shared_screen_selects_local_classifier(monkeypatch):
    monkeypatch.setattr(local_llama, "_model_pair", lambda: (lambda text, **kwargs: {"input_ids": text}, None))
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=False, tokens=4, duration=0.01,
    ))

    async def remote(*_):
        raise AssertionError("Remote classifier must not run in local mode")

    outcome = asyncio.run(screen_user_text_async(
        "Ordinary experience", local_llama.MODEL, 10, classify=remote,
    ))
    assert outcome.allowed
    assert outcome.model_usages == []


def test_local_trace_has_chunk_metadata_without_text(monkeypatch):
    monkeypatch.setattr(local_llama, "_model_pair", lambda: (lambda text, **kwargs: {"input_ids": text}, None))
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=False, tokens=4, duration=0.01,
    ))
    spans = []

    def span(name, **attributes):
        spans.append((name, attributes))
        return nullcontext()

    monkeypatch.setattr("screening.screen_user_text.logfire.span", span)
    outcome = screen_user_text("secret resume sentence", local_llama.MODEL, 10)
    assert outcome.allowed
    assert spans[0][1]["model"] == local_llama.MODEL
    assert spans[0][1]["chunk_count"] == 1
    assert "secret resume sentence" not in str(spans)


def test_local_chunks_cover_every_character_when_tokens_force_smaller_windows(monkeypatch):
    monkeypatch.setattr(local_llama, "_model_pair", lambda: (
        lambda text, **kwargs: {"input_ids": [0] * (len(text) * 2 + 2)}, None,
    ))
    text = "a" * 2800 + "tail"
    chunks = list(local_llama.iter_chunks(text))
    assert all(count <= 512 for _, count in chunks)
    assert len(chunks) > 10
    assert chunks[-1][0].endswith("tail")
    assert chunks[0][0] == text[:len(chunks[0][0])]
    assert all(first[-1] == second[0] for (first, _), (second, _) in pairwise(chunks))
