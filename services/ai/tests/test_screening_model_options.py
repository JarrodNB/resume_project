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
from screening.session import screening_session
from worker.settings import WorkerSettings

JEV = "typesafe:jev-1.13.0"
LLM = "llm"
DEFAULT_LLM_MODEL = "openai:gpt-5-nano"


def _run(model, blocked=False):
    screen = (SimpleNamespace(prompt_injection=blocked) if model == JEV else
              SimpleNamespace(blocked=blocked))
    return SimpleNamespace(screen=screen, model_name=model, usage=RunUsage(),
                           confidence={"prompt_injection": 1.0})


@pytest.mark.parametrize("primary,fallback", list(product(
    (JEV, LLM, local_llama.MODEL), repeat=2)))
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


def test_legacy_model_specific_selection_maps_to_llm():
    settings = WorkerSettings(user_text_screen_model=DEFAULT_LLM_MODEL,
                              user_text_screen_fallback_model=DEFAULT_LLM_MODEL)
    assert settings.user_text_screen_model == settings.user_text_screen_fallback_model == LLM


@pytest.mark.parametrize("model", ["llm", "openai:unknown-model",
                                    "openai:text-embedding-3-small", "jev-1.13.0"])
def test_screening_llm_requires_a_priced_generative_model(model):
    with pytest.raises(ValueError):
        WorkerSettings(user_text_screen_llm_model=model)


@pytest.mark.parametrize("llm_is_primary", [False, True])
def test_configured_llm_model_is_used_in_either_position(monkeypatch, llm_is_primary):
    concrete_model = "openai:gpt-6-luna"
    calls = []
    monkeypatch.setenv("USER_TEXT_SCREEN_LLM_MODEL", concrete_model)
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", JEV if llm_is_primary else LLM)
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")

    def jev(text, model, timeout_seconds):
        calls.append(model)
        if not llm_is_primary:
            raise RuntimeError("Jev unavailable")
        return _run(model)

    def llm(text, model, timeout_seconds):
        calls.append(model)
        if llm_is_primary:
            raise RuntimeError("LLM unavailable")
        return _run(model)

    monkeypatch.setattr(screening, "screen_user_message", jev)
    monkeypatch.setattr(screening, "screen_fallback_message", llm)
    primary = LLM if llm_is_primary else JEV
    result = screening.screen_user_text("career note", primary, 1, check_phrases=False)
    assert result.allowed
    assert calls == ([concrete_model, JEV] if llm_is_primary else [JEV, concrete_model])
    expected_model = JEV if llm_is_primary else concrete_model
    assert result.model_usages[-1].model == expected_model


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
    result = screening.screen_user_text("career note", LLM, 1, check_phrases=False)
    assert result.allowed and calls == [DEFAULT_LLM_MODEL, JEV]


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
    assert screening.screen_user_text("career note", LLM, 1, check_phrases=False).allowed


def test_local_llama_recovers_with_nano(monkeypatch):
    calls = []
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", LLM)
    monkeypatch.setattr(local_llama, "iter_chunks", lambda text: iter([(text, len(text))]))
    monkeypatch.setattr(local_llama, "classify_chunk", lambda *_: (
        (_ for _ in ()).throw(RuntimeError("Llama unavailable"))))
    monkeypatch.setattr(screening, "screen_fallback_message", lambda text, model, timeout_seconds: (
        calls.append(model) or _run(model)))
    result = screening.screen_user_text("career note", local_llama.MODEL, 1,
                                        check_phrases=False)
    assert result.allowed and calls == [DEFAULT_LLM_MODEL]


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


@pytest.mark.parametrize("async_path", [False, True])
def test_local_fallback_usage_is_not_repeated_from_cache(monkeypatch, async_path):
    calls = []
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", LLM)
    monkeypatch.setattr(local_llama, "iter_chunks", lambda text: iter([(text, len(text))]))

    def unavailable(*_args):
        raise RuntimeError("Llama unavailable")

    def nano(text, model, timeout_seconds):
        calls.append(model)
        return _run(model)

    async def async_nano(text, model, timeout_seconds):
        return nano(text, model, timeout_seconds)

    monkeypatch.setattr(local_llama, "classify_chunk", unavailable)
    monkeypatch.setattr(screening, "screen_fallback_message", nano)

    async def check_async():
        async def unused_jev(*_args):
            raise AssertionError("Jev must not run")

        first = await screening.screen_user_text_async(
            "career note", local_llama.MODEL, 1, check_phrases=False,
            classify=unused_jev, classify_fallback=async_nano,
        )
        second = await screening.screen_user_text_async(
            "career note", local_llama.MODEL, 1, check_phrases=False,
            classify=unused_jev, classify_fallback=async_nano,
        )
        return first, second

    with screening_session():
        if async_path:
            first, second = asyncio.run(check_async())
        else:
            first = screening.screen_user_text("career note", local_llama.MODEL, 1,
                                               check_phrases=False)
            second = screening.screen_user_text("career note", local_llama.MODEL, 1,
                                                check_phrases=False)
    assert first.allowed and second.allowed
    assert len(first.model_usages) == 1 and second.model_usages == []
    assert calls == [DEFAULT_LLM_MODEL]


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
        "career note", LLM, 1, check_phrases=False, classify=jev,
        classify_fallback=nano,
    ))
    assert result.allowed and calls == [DEFAULT_LLM_MODEL, JEV]


def test_async_primary_uses_configured_llm_model(monkeypatch):
    concrete_model = "openai:gpt-6-luna"
    monkeypatch.setenv("USER_TEXT_SCREEN_LLM_MODEL", concrete_model)
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", LLM)
    calls = []

    async def llm(text, model, timeout_seconds):
        calls.append(model)
        return _run(model)

    async def unused_jev(*_args):
        raise AssertionError("Jev must not run")

    result = asyncio.run(screening.screen_user_text_async(
        "career note", LLM, 1, check_phrases=False, classify=unused_jev,
        classify_fallback=llm,
    ))
    assert result.allowed and calls == [concrete_model]


def test_scoped_interview_fallback_ignores_general_screening_choice(monkeypatch):
    """The fixed interview path retains its accounted Nano recovery model."""
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", local_llama.MODEL)
    monkeypatch.setenv("USER_TEXT_SCREEN_LLM_MODEL", "openai:gpt-6-luna")
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline")
    calls = []

    async def unavailable_jev(text, model, timeout_seconds):
        calls.append(model)
        raise RuntimeError("Jev unavailable")

    async def interview_nano(text, model, timeout_seconds):
        calls.append(model)
        return _run(model)

    result = asyncio.run(screening.screen_user_text_async(
        "career note", JEV, 1, check_phrases=False, classify=unavailable_jev,
        classify_fallback=interview_nano, _fallback_model=DEFAULT_LLM_MODEL,
    ))
    assert result.allowed and calls == [JEV, DEFAULT_LLM_MODEL]


def test_screening_timeout_caps_both_attempts(monkeypatch):
    timeouts = []
    monkeypatch.setenv("USER_TEXT_SCREEN_TIMEOUT_SECONDS", "0.15")
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", LLM)
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
