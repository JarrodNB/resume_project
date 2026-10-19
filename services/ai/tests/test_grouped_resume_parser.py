"""Exercise complete concurrent parsing through its public synchronous interface."""

import asyncio

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage, UsageLimits

from agents.resume_parsing_agent import parse_resume_text, resume_parsing_agent


def parse(timeout=5):
    return parse_resume_text(
        "A complete masked resume", "openai:gpt-5-mini", "low", timeout, "openai:gpt-5-nano"
    )


def test_groups_overlap_and_assemble_in_fixed_order():
    active = 0
    peak = 0
    arrived = asyncio.Event()

    async def answer(messages, info):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == 3:
            arrived.set()
        await asyncio.wait_for(arrived.wait(), 0.5)
        schema = info.output_tools[0].parameters_json_schema["properties"]
        if "experiences" in schema:
            await asyncio.sleep(0.03)
            args = {
                "experiences": [
                    {"company": "Acme", "title": "Engineer", "highlights": ["Built a thing"]}
                ],
                "parsing_warnings": ["Experience warning", "Shared"],
            }
        elif "projects" in schema:
            args = {
                "projects": [{"name": "Demo"}],
                "skills": [{"name": "Python"}],
                "parsing_warnings": ["Shared"],
            }
        else:
            await asyncio.sleep(0.01)
            args = {"summary": "Summary", "parsing_warnings": ["Profile warning"]}
        active -= 1
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, args)],
            usage=RequestUsage(input_tokens=10, output_tokens=2),
        )

    with resume_parsing_agent.override(model=FunctionModel(answer)):
        result = parse()
    assert peak == 3
    assert result.parsed_resume.experiences[0].highlights == ["Built a thing"]
    assert result.parsed_resume.skills[0].name == "Python"
    assert result.parsed_resume.summary == "Summary"
    assert result.parsed_resume.parsing_warnings == [
        "Experience warning",
        "Shared",
        "Profile warning",
    ]
    assert result.usage.input_tokens == 30


def test_combined_requests_reserve_inflight_capacity(monkeypatch):
    calls = 0
    cancelled = 0

    async def answer(messages, info):
        nonlocal calls, cancelled
        calls += 1
        try:
            await asyncio.sleep(10)
        finally:
            cancelled += 1

    monkeypatch.setattr(
        "agents.resume_parsing_agent.agent_usage_limits",
        lambda settings: UsageLimits(request_limit=2),
    )
    with (
        resume_parsing_agent.override(model=FunctionModel(answer)),
        pytest.raises(UsageLimitExceeded),
    ):
        parse()
    assert calls == 2
    assert cancelled == 2


def test_whole_deadline_cancels_and_awaits_every_group():
    cancelled = []

    async def answer(messages, info):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    with resume_parsing_agent.override(model=FunctionModel(answer)), pytest.raises(TimeoutError):
        parse(0.8)
    assert len(cancelled) == 3


def test_success_preserves_each_groups_answering_model(offline_model_resolution):
    from pydantic_ai.exceptions import ModelHTTPError

    async def answer(messages, info):
        properties = info.output_tools[0].parameters_json_schema["properties"]
        if "projects" in properties:
            raise ModelHTTPError(503, "synthetic", "unavailable")
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=10, output_tokens=2),
        )

    async def fallback(messages, info):
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=10, output_tokens=2),
        )

    offline_model_resolution(
        "openai:gpt-5-mini", FunctionModel(answer, model_name="openai:gpt-5-mini")
    )
    offline_model_resolution(
        "openai:gpt-5-nano", FunctionModel(fallback, model_name="openai:gpt-5-nano")
    )
    from worker.task_usage import collect_task_usage

    with collect_task_usage():
        result = parse()
    assert [entry.model for entry in result.model_usages] == [
        "openai:gpt-5-mini",
        "openai:gpt-5-nano",
        "openai:gpt-5-mini",
    ]
    assert result.usage.input_tokens == 30


def test_source_screened_once_and_group_prompts_reuse_exact_approval(monkeypatch):
    from pydantic_ai.models.test import TestModel

    from screening import prompt_guardrail

    calls = []
    classify = prompt_guardrail._screen_prompt_text

    async def screen(text, model, timeout):
        calls.append(text)
        return await classify(text, model, timeout)

    monkeypatch.setattr(prompt_guardrail, "_screen_prompt_text", screen)
    with resume_parsing_agent.override(model=TestModel()):
        parse()
    assert calls == ["A complete masked resume"]


def test_combined_tokens_fail_even_when_each_response_fits(monkeypatch):
    async def answer(messages, info):
        await asyncio.sleep(0.01)
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=10, output_tokens=4),
        )

    monkeypatch.setattr(
        "agents.resume_parsing_agent.agent_usage_limits",
        lambda settings: UsageLimits(output_tokens_limit=10),
    )
    with (
        resume_parsing_agent.override(model=FunctionModel(answer)),
        pytest.raises(UsageLimitExceeded),
    ):
        parse()


def test_fallback_charges_survive_later_group_failure(offline_model_resolution):
    from pydantic_ai.exceptions import ModelHTTPError

    from worker.task_usage import collect_task_usage

    async def primary(messages, info):
        raise ModelHTTPError(503, "synthetic", "unavailable")

    async def fallback(messages, info):
        properties = info.output_tools[0].parameters_json_schema["properties"]
        if "contact" in properties:
            await asyncio.sleep(0.03)
            raise ValueError("synthetic group failure")
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=11, output_tokens=3),
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(primary))
    offline_model_resolution(
        "openai:gpt-5-nano", FunctionModel(fallback, model_name="openai:gpt-5-nano")
    )
    with (
        collect_task_usage() as charges,
        pytest.raises(ValueError, match="synthetic group failure"),
    ):
        parse()
    assert charges.incomplete
    assert len(charges.entries) == 2
    assert all(entry.model == "openai:gpt-5-nano" for entry in charges.entries)
    assert sum(entry.input_tokens for entry in charges.entries) == 22


def test_group_failure_cancels_and_awaits_siblings():
    started = 0
    cancelled = []
    ready = asyncio.Event()

    async def answer(messages, info):
        nonlocal started
        started += 1
        if started == 3:
            ready.set()
        await ready.wait()
        if "projects" in info.output_tools[0].parameters_json_schema["properties"]:
            raise ValueError("group failed")
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    with (
        resume_parsing_agent.override(model=FunctionModel(answer)),
        pytest.raises(ValueError, match="group failed"),
    ):
        parse()
    assert len(cancelled) == 2
