"""Exercise local prompt injection screening through the public screening interface."""

import asyncio
import threading
from contextlib import nullcontext
from itertools import pairwise
from time import monotonic
from types import SimpleNamespace

import screening.screen_user_text as screening_module
from screening import local_llama
from screening.screen_user_text import screen_user_text, screen_user_text_async
from screening.session import current_session, screening_session


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


def test_async_guard_reuses_local_decision_from_sync_screen(monkeypatch):
    calls = []
    monkeypatch.setattr(local_llama, "iter_chunks", lambda text: iter([(text, 3)]))

    def classify(chunk, model, timeout):
        calls.append(chunk)
        return SimpleNamespace(blocked=False, tokens=3, duration=0.01)

    monkeypatch.setattr(local_llama, "classify_chunk", classify)

    async def remote(*_):
        raise AssertionError("Remote classifier must not run")

    with screening_session(10):
        first = screen_user_text("shared career fact", local_llama.MODEL, 10)
        screening_module._local_inference_lock.acquire()
        try:
            second = asyncio.run(screen_user_text_async(
                "shared career fact", local_llama.MODEL, 0.02, classify=remote, check_phrases=True,
            ))
        finally:
            screening_module._local_inference_lock.release()
    assert first.allowed and second.allowed
    assert calls == ["shared career fact"]


def test_concurrent_async_local_inputs_wait_for_inference(monkeypatch):
    monkeypatch.setattr(local_llama, "iter_chunks", lambda text: iter([(text, 3)]))

    def classify(chunk, model, timeout):
        threading.Event().wait(0.05)
        return SimpleNamespace(blocked=False, tokens=3, duration=0.05)

    monkeypatch.setattr(local_llama, "classify_chunk", classify)

    async def remote(*_):
        raise AssertionError("Remote classifier must not run")

    async def check():
        return await asyncio.gather(*(
            screen_user_text_async(f"career fact {index}", local_llama.MODEL, 0.5,
                                   classify=remote) for index in range(2)
        ))

    outcomes = asyncio.run(check())
    assert all(outcome.allowed for outcome in outcomes)


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
    assert spans[0][1]["chunk_index"] == 0
    assert "secret resume sentence" not in str(spans)


def test_async_local_load_timeout_cannot_approve_in_background(monkeypatch):
    finished = threading.Event()

    def slow_chunks(text):
        threading.Event().wait(0.2)
        finished.set()
        return [(text, 3)]

    monkeypatch.setattr(local_llama, "iter_chunks", slow_chunks)
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=False, tokens=3, duration=0.01,
    ))

    async def remote(*_):
        raise AssertionError("Remote classifier must not run")

    async def check():
        with screening_session(1):
            started = monotonic()
            outcome = await screen_user_text_async("slow input", local_llama.MODEL, 0.02,
                                                   classify=remote)
            elapsed = monotonic() - started
            assert outcome.unchecked and not outcome.allowed
            assert elapsed < 0.15
            assert await asyncio.to_thread(finished.wait, 1)
            assert "slow input" not in current_session().allowed_sources

    asyncio.run(check())


def test_sync_local_load_timeout_cannot_approve_in_background(monkeypatch):
    finished = threading.Event()

    def slow_chunks(text):
        threading.Event().wait(0.2)
        finished.set()
        return [(text, 3)]

    monkeypatch.setattr(local_llama, "iter_chunks", slow_chunks)
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=False, tokens=3, duration=0.01,
    ))
    with screening_session(1):
        started = monotonic()
        outcome = screen_user_text("slow sync input", local_llama.MODEL, 0.02)
        assert outcome.unchecked and not outcome.allowed
        assert monotonic() - started < 0.15
        assert finished.wait(1)
        assert "slow sync input" not in current_session().allowed_sources


def test_local_screen_stops_tokenizing_after_first_block(monkeypatch):
    seen = []

    def chunks(text):
        seen.append("first")
        yield text[:4], 4
        seen.append("second")
        yield text[4:], 4

    monkeypatch.setattr(local_llama, "iter_chunks", chunks)
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=True, tokens=4, duration=0.01,
    ))
    outcome = screen_user_text("abcdefgh", local_llama.MODEL, 1)
    assert not outcome.allowed and not outcome.unchecked
    assert seen == ["first"]


def test_stalled_local_model_does_not_queue_screening_threads(monkeypatch):
    release = threading.Event()
    entered = threading.Event()
    calls = []

    def stalled_chunks(text):
        calls.append(text)
        entered.set()
        release.wait(1)
        return [(text, 3)]

    monkeypatch.setattr(local_llama, "iter_chunks", stalled_chunks)
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=False, tokens=3, duration=0.01,
    ))
    try:
        assert screen_user_text("first stalled input", local_llama.MODEL, 0.02).unchecked
        assert entered.wait(1)
        for index in range(3):
            assert screen_user_text(f"another input {index}", local_llama.MODEL, 0.02).unchecked
        assert calls == ["first stalled input"]
        assert sum(thread.name == "local-prompt-screen" for thread in threading.enumerate()) == 1
    finally:
        release.set()


def test_async_stalled_model_does_not_queue_screening_threads(monkeypatch):
    release = threading.Event()
    entered = threading.Event()
    calls = []

    def stalled_chunks(text):
        calls.append(text)
        entered.set()
        release.wait(1)
        return [(text, 3)]

    monkeypatch.setattr(local_llama, "iter_chunks", stalled_chunks)
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=False, tokens=3, duration=0.01,
    ))

    async def remote(*_):
        raise AssertionError("Remote classifier must not run")

    async def check():
        first = asyncio.create_task(screen_user_text_async(
            "first async stalled input", local_llama.MODEL, 0.02, classify=remote,
        ))
        assert await asyncio.to_thread(entered.wait, 1)
        others = [screen_user_text_async(f"async input {index}", local_llama.MODEL, 0.02,
                                         classify=remote) for index in range(3)]
        results = await asyncio.gather(first, *others)
        assert all(result.unchecked for result in results)
        assert calls == ["first async stalled input"]
        assert sum(thread.name.startswith("asyncio_") for thread in threading.enumerate()) <= 1

    try:
        asyncio.run(check())
    finally:
        release.set()


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
