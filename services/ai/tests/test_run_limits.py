"""
Description: Tests for the request, tool-call, and token caps on an agent run.
Index:
    - test_*: one behavior per test
"""

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import RunUsage, UsageLimits

from agents.resume_parsing_agent import parse_resume_text
from llm.run_limits import agent_usage_limits
from screening.screen_user_text import screen_user_text
from worker.settings import WorkerSettings


def test_caps_come_from_settings() -> None:
    """Request, tool-call, and token caps are the settings values, including no tool calls."""
    settings = WorkerSettings(
        llm_request_limit=6,
        llm_tool_calls_limit=0,
        llm_output_tokens_limit=64_000,
        llm_total_tokens_limit=128_000,
    )

    limits = agent_usage_limits(settings)

    assert limits.request_limit == 6
    assert limits.tool_calls_limit == 0
    assert limits.output_tokens_limit == 64_000
    assert limits.total_tokens_limit == 128_000
    assert WorkerSettings.model_fields["llm_request_limit"].default == 6
    assert WorkerSettings.model_fields["llm_tool_calls_limit"].default == 0


def test_a_run_past_the_request_cap_does_not_call_the_model(
    monkeypatch: pytest.MonkeyPatch, offline_model_resolution,
) -> None:
    """The next request is refused before the model is called. Nothing is returned."""
    calls = {"count": 0}

    def answer(_messages: list[object], info: AgentInfo) -> ModelResponse:
        """Would be a valid parse. The cap must stop the run before this."""
        calls["count"] += 1
        return ModelResponse(
            parts=[ToolCallPart(tool_name=info.output_tools[0].name, args={})],
            usage=RunUsage(input_tokens=12, output_tokens=4),
        )

    monkeypatch.setattr(
        "agents.resume_parsing_agent.agent_usage_limits",
        lambda _settings: UsageLimits(request_limit=0, tool_calls_limit=0),
    )
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(answer))
    with pytest.raises(UsageLimitExceeded):
        parse_resume_text(
            "Jane Doe",
            model="openai:gpt-5-mini",
            thinking="low",
            timeout_seconds=5,
            fallback_model="openai:gpt-5-nano",
        )

    assert calls["count"] == 0


def test_a_run_past_the_output_token_cap_fails(
    monkeypatch: pytest.MonkeyPatch, offline_model_resolution,
) -> None:
    """An oversized response fails the run. The caller does not receive a partial parse."""

    def answer(_messages: list[object], info: AgentInfo) -> ModelResponse:
        """A tiny parse that reports more output tokens than the cap."""
        return ModelResponse(
            parts=[ToolCallPart(tool_name=info.output_tools[0].name, args={})],
            usage=RunUsage(input_tokens=12, output_tokens=100),
        )

    monkeypatch.setattr(
        "agents.resume_parsing_agent.agent_usage_limits",
        lambda _settings: UsageLimits(request_limit=6, tool_calls_limit=0, output_tokens_limit=10),
    )
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(answer))
    with pytest.raises(UsageLimitExceeded):
        parse_resume_text(
            "Jane Doe",
            model="openai:gpt-5-mini",
            thinking="low",
            timeout_seconds=5,
            fallback_model="openai:gpt-5-nano",
        )


def test_a_screen_run_limit_is_not_treated_as_unchecked(monkeypatch: pytest.MonkeyPatch) -> None:
    """A cap on the Jev call fails the task. It does not omit the text as unchecked."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "present")

    def raise_limit(_text: str, **_kwargs: object) -> None:
        """The screen hit its cap."""
        raise UsageLimitExceeded("output_tokens_limit")

    monkeypatch.setattr("screening.screen_user_text.screen_user_message", raise_limit)

    with pytest.raises(UsageLimitExceeded):
        screen_user_text("I led a team of four.", model="typesafe:jev-1.13.0", timeout_seconds=5)
