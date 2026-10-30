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


def test_gap_preparation_screens_readable_sources_and_keeps_exact_prompt(monkeypatch):
    from datetime import date

    from gap_analysis.prepare_gap_analysis import prepare_gap_analysis
    from screening.screen_user_text import ScreenOutcome
    from screening.session import screening_session

    context = build_gap_analysis_context()
    requests = []

    def allow(text, **_kwargs):
        requests.append(text)
        return ScreenOutcome(allowed=True)

    monkeypatch.setattr("gap_analysis.prepare_gap_analysis.screen_user_text", allow)
    with screening_session():
        prepared = prepare_gap_analysis(
            context, today=date(2026, 1, 1), screen_model="test", timeout_seconds=5,
        )
    assert prepared.prompt is not None
    assert len(requests) == 2
    assert "Job title:\nPlatform Engineer" in requests[0]
    assert "Requirements:\n" in requests[0]
    assert '"id"' not in requests[0]
    assert '"requirements"' not in requests[0]
    assert "Entry 1\n" in requests[1]
    assert '"id"' not in requests[1]
    assert "[R1]" in prepared.prompt.text


def test_large_valid_job_stays_within_screening_limit_after_readable_format(monkeypatch):
    """Readable separators must not reject a saved job that fit the prior source cap."""
    from datetime import date

    import text_limits
    from gap_analysis.prepare_gap_analysis import prepare_gap_analysis
    from screening.screen_user_text import ScreenOutcome
    from screening.session import screening_session

    context = build_gap_analysis_context()
    context.job.requirements = ["x" * 995 for _ in range(80)]
    original = context.job.model_dump_json(exclude_none=True, exclude={"responsibilities"})
    assert len(original) < text_limits.MAX_SCREENED_TEXT
    requests = []
    monkeypatch.setattr("gap_analysis.prepare_gap_analysis.screen_user_text",
                        lambda text, **_: requests.append(text) or ScreenOutcome(allowed=True))
    with screening_session():
        prepared = prepare_gap_analysis(context, today=date(2026, 1, 1),
                                        screen_model="test", timeout_seconds=5)
    assert prepared.prompt is not None
    assert len(requests) == 2
    assert len(requests[0]) <= text_limits.MAX_SCREENED_TEXT


def test_gap_sources_screen_once_without_assembled_request(monkeypatch, task_dependencies, fake_context_reader):
    context = build_gap_analysis_context()
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = context
    requests = []

    async def unexpected(*args):
        pytest.fail("Approved gap context was screened again as an assembled prompt")

    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", unexpected)
    with (
        user_text_screen_agent.override(model=jev_model(requests)),
        gap_analysis_agent.override(model=TestModel(custom_output_args=VALID_OUTPUT)),
    ):
        for _delivery in range(2):
            result = handle_analyze_gaps_task(build_analyze_gaps_task(), task_dependencies)
            assert result.status == "completed"
    # One job and one complete library source in each fresh delivery.
    assert len(requests) == 4
    assert requests[:2] == requests[2:]
    assert sum("Built Python APIs" in text for text in requests[:2]) == 1
    assert sum("Platform Engineer" in text for text in requests[:2]) == 1
    assert sum(usage.input_tokens for usage in result.usage[1:]) == 200


def test_required_gap_job_block_prevents_generation(task_dependencies, fake_context_reader):
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()

    requests = []
    with user_text_screen_agent.override(model=jev_model(requests, blocked_text="Platform Engineer")):
        result = handle_analyze_gaps_task(build_analyze_gaps_task(), task_dependencies)
    assert result.status == "failed"
    assert len(requests) == 1


def test_blocked_library_stops_analysis_and_retains_usage(task_dependencies, fake_context_reader):
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()
    requests = []
    with user_text_screen_agent.override(model=jev_model(requests, blocked_text="Built Python APIs")):
        result = handle_analyze_gaps_task(build_analyze_gaps_task(), task_dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert len(requests) == 2
    assert sum(item.input_tokens for item in result.usage) == 200


def test_unavailable_required_job_fails_closed(monkeypatch, task_dependencies, fake_context_reader):
    monkeypatch.delenv("TYPESAFE_API_KEY")
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()
    result = handle_analyze_gaps_task(build_analyze_gaps_task(), task_dependencies)
    assert result.status == "failed"
    assert "unavailable" in result.error_message


def test_direct_gap_call_still_screens_unknown_prompt(monkeypatch):
    from datetime import date

    prompt = build_gap_analysis_prompt(build_gap_analysis_context(), today=date(2026, 1, 1))
    calls = []

    async def reject(text, *args):
        calls.append(text)
        raise RuntimeError("screen unavailable")

    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", reject)
    with pytest.raises(InputBlocked, match="unavailable"):
        analyze_gaps(prompt, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini")
    assert calls == [prompt.text]


@pytest.mark.parametrize("failure", ["block", "outage", "limit"])
def test_queued_library_failure_reports_real_usage_once(
    monkeypatch, task_dependencies, fake_context_reader, offline_model_resolution, failure,
):
    """Real queue publication keeps earlier charges even when preparation cannot finish."""
    import json

    from pydantic_ai.exceptions import UsageLimitExceeded

    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message

    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()
    requests = []
    model = jev_model(requests, blocked_text="Built Python APIs" if failure == "block" else None)

    def respond(messages, info):
        if requests and failure == "outage":
            raise RuntimeError("Synthetic library screening outage")
        if requests and failure == "limit":
            raise UsageLimitExceeded("Synthetic usage cap")
        return model.function(messages, info)

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(respond, model_name="jev-1.13.0"))
    queue = FakeResultQueue()
    assert process_task_message(build_analyze_gaps_task().model_dump_json(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "failed"
    assert result["result"] is None
    assert sum(item["input_tokens"] for item in result["usage"]) == (200 if failure == "block" else 100)
