"""Verify prompt-only decisions and the three configurable screening model choices."""

import asyncio
from itertools import product
from time import monotonic
from types import SimpleNamespace

import pytest
from pydantic_ai.usage import RunUsage

import screening.screen_user_text as screening
from schemas.user_text_fallback import UserTextFallbackScreen
from schemas.user_text_screen import UserTextScreen
from screening import local_llama
from worker.settings import WorkerSettings

JEV = "typesafe:jev-1.13.0"
NANO = "openai:gpt-5-nano"


def _run(model, blocked=False):
    screen = (SimpleNamespace(prompt_injection=blocked) if model == JEV else
              SimpleNamespace(blocked=blocked))
    return SimpleNamespace(screen=screen, model_name=model, usage=RunUsage(),
                           confidence={"prompt_injection": 1.0})


@pytest.mark.parametrize("primary,fallback", list(product(
    (JEV, NANO, local_llama.MODEL), repeat=2)))
def test_settings_accept_three_screening_models(primary, fallback):
    settings = WorkerSettings(user_text_screen_model=primary,
                              user_text_screen_fallback_model=fallback,
                              user_text_screen_timeout_seconds=2.5)
    assert (settings.user_text_screen_model, settings.user_text_screen_fallback_model,
            settings.user_text_screen_timeout_seconds) == (primary, fallback, 2.5)


def test_prompt_only_schemas_ignore_harmful_request():
    assert set(UserTextScreen.model_fields) == {"prompt_injection"}
    assert set(UserTextFallbackScreen.model_fields) == {"prompt_injection"}


def test_screening_timeout_must_be_positive():
    with pytest.raises(ValueError):
        WorkerSettings(user_text_screen_timeout_seconds=0)


def test_nano_primary_recovers_with_jev(monkeypatch):
    calls = []
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", JEV)
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")

    def nano(text, model, timeout_seconds):
        calls.append(model)
        raise RuntimeError("Nano unavailable")

    def jev(text, model, timeout_seconds):
        calls.append(model)
        return _run(model)

    monkeypatch.setattr(screening, "screen_fallback_message", nano)
    monkeypatch.setattr(screening, "screen_user_message", jev)
    result = screening.screen_user_text("career note", NANO, 1, check_phrases=False)
    assert result.allowed and calls == [NANO, JEV]


def test_jev_recovers_with_local_llama(monkeypatch):
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", local_llama.MODEL)
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")
    monkeypatch.setattr(screening, "screen_user_message", lambda *_args, **_kwargs: (
        (_ for _ in ()).throw(RuntimeError("Jev unavailable"))))
    monkeypatch.setattr(local_llama, "iter_chunks", lambda text: iter([(text, len(text))]))
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=False, duration=0.01))
    result = screening.screen_user_text("career note", JEV, 1, check_phrases=False)
    assert result.allowed


def test_nano_recovers_with_local_llama(monkeypatch):
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", local_llama.MODEL)

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("Nano unavailable")

    monkeypatch.setattr(screening, "screen_fallback_message", unavailable)
    monkeypatch.setattr(local_llama, "iter_chunks", lambda text: iter([(text, len(text))]))
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: SimpleNamespace(
        blocked=False, duration=0.01))
    assert screening.screen_user_text("career note", NANO, 1, check_phrases=False).allowed


def test_local_llama_recovers_with_nano(monkeypatch):
    calls = []
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", NANO)
    monkeypatch.setattr(local_llama, "iter_chunks", lambda text: iter([(text, len(text))]))
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: (
        (_ for _ in ()).throw(RuntimeError("Llama unavailable"))))
    monkeypatch.setattr(screening, "screen_fallback_message", lambda text, model, timeout_seconds: (
        calls.append(model) or _run(model)))
    result = screening.screen_user_text("career note", local_llama.MODEL, 1,
                                        check_phrases=False)
    assert result.allowed and calls == [NANO]


def test_local_llama_recovers_with_jev(monkeypatch):
    calls = []
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", JEV)
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")
    monkeypatch.setattr(local_llama, "iter_chunks", lambda text: iter([(text, len(text))]))

    def unavailable(*_args):
        raise RuntimeError("Llama unavailable")

    def jev(text, model, timeout_seconds):
        calls.append(model)
        return _run(model)

    monkeypatch.setattr(local_llama, "classify_chunk", unavailable)
    monkeypatch.setattr(screening, "screen_user_message", jev)
    result = screening.screen_user_text("career note", local_llama.MODEL, 1,
                                        check_phrases=False)
    assert result.allowed and calls == [JEV]


def test_async_nano_primary_recovers_with_jev(monkeypatch):
    calls = []
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", JEV)
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")

    async def nano(text, model, timeout_seconds):
        calls.append(model)
        raise RuntimeError("Nano unavailable")

    async def jev(text, model, timeout_seconds):
        calls.append(model)
        return _run(model)

    result = asyncio.run(screening.screen_user_text_async(
        "career note", NANO, 1, check_phrases=False, classify=jev,
        classify_fallback=nano,
    ))
    assert result.allowed and calls == [NANO, JEV]


def test_screening_timeout_caps_both_attempts(monkeypatch):
    timeouts = []
    monkeypatch.setenv("USER_TEXT_SCREEN_TIMEOUT_SECONDS", "0.15")
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", NANO)
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")

    def jev(text, model, timeout_seconds):
        timeouts.append(timeout_seconds)
        __import__("threading").Event().wait(0.03)
        raise RuntimeError("Jev unavailable")

    def nano(text, model, timeout_seconds):
        timeouts.append(timeout_seconds)
        return _run(model)

    monkeypatch.setattr(screening, "screen_user_message", jev)
    monkeypatch.setattr(screening, "screen_fallback_message", nano)
    started = monotonic()
    result = screening.screen_user_text("career note", JEV, 5, check_phrases=False)
    assert result.allowed
    assert 0 < timeouts[1] < timeouts[0] <= 0.15
    assert monotonic() - started < 0.15
