"""Check cohesive gap inputs and the actual Jev boundary before generation."""

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputBlocked

from agents.gap_analysis_agent import analyze_gaps, gap_analysis_agent
from agents.user_text_screen_agent import user_text_screen_agent
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from screening.library_inputs import LIBRARY_INPUT_OMITTED_WARNING
from tests.fakes import build_gap_analysis_context
from tests.test_analyze_gaps_handler import JOB_ID, USER_ID, VALID_OUTPUT, build_analyze_gaps_task
from worker.analyze_gaps_handler import handle_analyze_gaps_task


def jev_model(requests, *, blocked_text=None):
    """Observe actual model requests under the production Jev agent and decision policy."""
    def answer(messages, info):
        text = next(part.content for part in messages[-1].parts if isinstance(part, UserPromptPart))
        requests.append(text)
        return ModelResponse(
            parts=[ToolCallPart(tool_name=info.output_tools[0].name, args={
                "prompt_injection": bool(blocked_text and blocked_text in text),
                "harmful_request": False,
            })],
            model_name="jev-1.13.0", usage=RunUsage(input_tokens=100, output_tokens=1),
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}},
        )
    return FunctionModel(answer, model_name="jev-1.13.0")


def test_gap_sources_screen_once_without_assembled_request(monkeypatch, task_dependencies, fake_context_reader):
    context = build_gap_analysis_context()
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = context
    requests = []

    async def unexpected(*args):
        pytest.fail("Approved gap context was screened again as an assembled prompt")

    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", unexpected)
    with (
        user_text_screen_agent.override(model=jev_model(requests)),
        gap_analysis_agent.override(model=TestModel(custom_output_args=VALID_OUTPUT)),
    ):
        for _delivery in range(2):
            result = handle_analyze_gaps_task(build_analyze_gaps_task(), task_dependencies)
            assert result.status == "completed"
    # One job, summary, experience (including highlights), project, education, two skills.
    assert len(requests) == 14
    assert requests[:7] == requests[7:]
    assert sum("Built Python APIs" in text for text in requests[:7]) == 1
    assert sum("Platform Engineer" in text for text in requests[:7]) == 1
    assert sum(usage.input_tokens for usage in result.usage[1:]) == 700


def test_required_gap_job_block_prevents_generation(task_dependencies, fake_context_reader):
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()

    requests = []
    with user_text_screen_agent.override(model=jev_model(requests, blocked_text="Platform Engineer")), pytest.raises(InputBlocked):
        handle_analyze_gaps_task(build_analyze_gaps_task(), task_dependencies)
    assert len(requests) == 1


def test_optional_entry_omission_removes_its_evidence(task_dependencies, fake_context_reader):
    context = build_gap_analysis_context()
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = context
    requests = []
    output = VALID_OUTPUT | {"assessments": [
        VALID_OUTPUT["assessments"][0] | {"evidence_refs": ["S1"]},
        VALID_OUTPUT["assessments"][1] | {"evidence_refs": ["S2"]},
        VALID_OUTPUT["assessments"][2],
    ]}
    with (
        user_text_screen_agent.override(model=jev_model(requests, blocked_text="Built Python APIs")),
        gap_analysis_agent.override(model=TestModel(custom_output_args=output)),
    ):
        result = handle_analyze_gaps_task(build_analyze_gaps_task(), task_dependencies)
    assert result.status == "completed"
    assert result.result["warnings"] == [LIBRARY_INPUT_OMITTED_WARNING]
    evidence = [item for assessment in result.result["gap_analysis"]["assessments"] for item in assessment["evidence"]]
    assert {item["kind"] for item in evidence} == {"skill"}
    assert len(requests) == 7


def test_unavailable_required_job_fails_closed(monkeypatch, task_dependencies, fake_context_reader):
    monkeypatch.delenv("TYPESAFE_API_KEY")
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()
    with pytest.raises(InputBlocked, match="unavailable"):
        handle_analyze_gaps_task(build_analyze_gaps_task(), task_dependencies)


def test_direct_gap_call_still_screens_unknown_prompt(monkeypatch):
    from datetime import date

    prompt = build_gap_analysis_prompt(build_gap_analysis_context(), today=date(2026, 1, 1))
    calls = []

    async def reject(text, *args):
        calls.append(text)
        raise RuntimeError("screen unavailable")

    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", reject)
    with pytest.raises(InputBlocked, match="unavailable"):
        analyze_gaps(prompt, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini")
    assert calls == [prompt.text]
