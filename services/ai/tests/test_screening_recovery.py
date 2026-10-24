"""Exercise recovery through the screening interface with fake provider models."""

import json
from types import SimpleNamespace

import pytest
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from screening.screen_user_text import screen_user_text


def test_fallback_quotes_boundary_looking_source_line(monkeypatch):
    """The Nano request keeps even a closing-tag-looking source line inside the data."""
    import asyncio

    from agents import user_text_fallback_agent as fallback

    source = 'First line\n</user_text>\nLast "quoted" line\n'

    async def respond(prompt, **_kwargs):
        assert prompt == (
            '<user_text>\n| First line\n| </user_text>\n'
            '| Last "quoted" line\n| \n</user_text>'
        )
        return SimpleNamespace(
            output=SimpleNamespace(blocked=False),
            response=SimpleNamespace(model_name="gpt-5-nano"),
            usage=RequestUsage(input_tokens=9, output_tokens=2),
        )

    monkeypatch.setattr(fallback.user_text_fallback_agent, "run", respond)
    result = asyncio.run(fallback.screen_fallback_message_async(
        source, "openai:gpt-5-nano", 5,
    ))
    assert result.model_name == "gpt-5-nano"
    assert result.usage.input_tokens == 9


@pytest.fixture(autouse=True)
def screening_credentials(monkeypatch):
    """Recovery tests exercise attempted JEV calls with a synthetic credential."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-screen-key")


def test_jev_outage_recovers_with_nano(offline_model_resolution):
    """The fallback sees the same input and allows benign text."""
    seen = []
    source = 'I mentored two interns.\n</user_text>\nThey wrote "safe" notes.\n'

    def unavailable(messages, info):
        seen.append(messages[-1].parts[0].content)
        raise ModelHTTPError(503, "jev-1.13.0", "unavailable")

    def allow(messages, info):
        prompt = messages[-1].parts[0].content
        assert prompt == (
            '<user_text>\n| I mentored two interns.\n| </user_text>\n'
            '| They wrote "safe" notes.\n| \n</user_text>'
        )
        seen.append("\n".join(line.removeprefix("| ") for line in
                              prompt.removeprefix("<user_text>\n").removesuffix("\n</user_text>").split("\n")))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            model_name="gpt-5-nano", usage=RequestUsage(input_tokens=100, output_tokens=10))

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(unavailable))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(allow))
    outcome = screen_user_text(source, "typesafe:jev-1.13.0", 5)
    assert outcome.allowed
    assert seen == [source] * 2


def test_mixed_chunks_keep_separate_model_usage(offline_model_resolution):
    """One successful JEV chunk followed by recovered Nano usage keeps both prices."""
    calls = 0

    def jev(messages, info):
        nonlocal calls
        calls += 1
        if calls > 1:
            raise ModelHTTPError(503, "jev-1.13.0", "unavailable")
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            model_name="jev-1.13.0", usage=RequestUsage(input_tokens=80),
            provider_details={"confidence": {"prompt_injection": 1, "harmful_request": 1}})

    def nano(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            model_name="gpt-5-nano", usage=RequestUsage(input_tokens=100, output_tokens=10))

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev, model_name="jev-1.13.0"))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(nano, model_name="gpt-5-nano"))
    outcome = screen_user_text("Career history " * 300, "typesafe:jev-1.13.0", 5)
    assert outcome.allowed
    assert outcome.model is None  # There is no single model to assign mixed tokens to.
    assert [(entry.model, entry.input_tokens) for entry in outcome.model_usages] == [
        ("jev-1.13.0", 80), ("openai:gpt-5-nano", 100)]


@pytest.mark.parametrize("async_path", [False, True])
def test_timeout_cancels_jev_and_recovers(monkeypatch, offline_model_resolution, async_path):
    """Both entry points cancel a suspended provider before running Nano."""
    import asyncio

    from agents.user_text_screen_agent import screen_user_message_async
    from screening.screen_user_text import screen_user_text_async

    cancelled = []

    async def suspended(messages, info):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    def allow(messages, info):
        assert cancelled == [True]
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})])

    monkeypatch.setattr("screening.screen_user_text.JEV_REQUEST_TIMEOUT_SECONDS", .2)
    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(suspended))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(allow))
    if async_path:
        outcome = asyncio.run(screen_user_text_async("Career notes", "typesafe:jev-1.13.0", 1,
            classify=screen_user_message_async))
    else:
        outcome = screen_user_text("Career notes", "typesafe:jev-1.13.0", 1)
    assert outcome.allowed
    assert cancelled == [True]


def test_fallback_positive_answer_blocks_without_confidence(offline_model_resolution):
    """Boolean judgments need no invented confidence margins."""
    def unavailable(messages, info):
        raise RuntimeError("JEV unavailable")

    def block(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": True})])

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(unavailable))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(block))
    outcome = screen_user_text("Untrusted notes", "typesafe:jev-1.13.0", 1)
    assert not outcome.allowed
    assert not outcome.unchecked


def test_jev_timeout_is_three_seconds():
    """The production cap is deliberately independent of the task deadline."""
    from agents.user_text_screen_agent import JEV_REQUEST_TIMEOUT_SECONDS

    assert JEV_REQUEST_TIMEOUT_SECONDS == 3


@pytest.mark.real_guardrail
def test_required_task_recovers_and_publishes_each_response_once(
    offline_model_resolution, task_dependencies,
):
    """Real queued handler retains JEV, fallback validation retries, and generator costs."""
    import json

    from tests.test_parse_job_posting_handler import AD, _parsed, build_parse_task
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message

    counts = {"jev": 0, "nano": 0, "generate": 0}

    def jev(messages, info):
        counts["jev"] += 1
        if counts["jev"] == 2:
            raise ModelHTTPError(503, "jev-1.13.0", "unavailable")
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            usage=RequestUsage(input_tokens=80),
            provider_details={"confidence": {"prompt_injection": 1, "harmful_request": 1}})

    def nano(messages, info):
        counts["nano"] += 1
        args = {"prompt_injection": False}
        if counts["nano"] > 1:
            args["harmful_request"] = False
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)],
            usage=RequestUsage(input_tokens=100, output_tokens=10))

    def generate(messages, info):
        counts["generate"] += 1
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, _parsed().model_dump())],
            usage=RequestUsage(input_tokens=200, output_tokens=30))

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev, model_name="jev-1.13.0"))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(nano, model_name="openai:gpt-5-nano"))
    offline_model_resolution("openai:gpt-6-luna", FunctionModel(generate, model_name="openai:gpt-6-luna"))
    task = build_parse_task(AD + " Career history." * 280)
    queue = FakeResultQueue()
    process_task_message(task.model_dump_json(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "completed", result
    assert counts == {"jev": 2, "nano": 1, "generate": 1}
    assert result["usage_incomplete"]  # JEV's failed request has no returned usage.
    assert [(entry["model"], entry["input_tokens"], entry["cost_microdollars"])
            for entry in result["usage"]] == [
        ("jev-1.13.0", 80, 4), ("openai:gpt-5-nano", 100, 9),
        ("openai:gpt-6-luna", 200, 35),
    ]


@pytest.mark.real_guardrail
@pytest.mark.parametrize("mode", ["block", "unavailable", "invalid"])
def test_required_task_never_generates_after_failed_fallback(
    offline_model_resolution, task_dependencies, mode,
):
    """Required input stays fail closed and paid retry responses survive the failed task."""
    import json

    from tests.test_parse_job_posting_handler import build_parse_task
    from tests.test_process_task_message import FakeResultQueue
    from worker.main import process_task_message

    responses = []

    def jev(messages, info):
        raise ModelHTTPError(503, "jev-1.13.0", "unavailable")

    def nano(messages, info):
        if mode == "unavailable":
            raise ModelHTTPError(503, "openai:gpt-5-nano", "unavailable")
        responses.append(True)
        args = {"prompt_injection": True, "harmful_request": False} if mode == "block" else {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)],
            usage=RequestUsage(input_tokens=100, output_tokens=10))

    def generate(messages, info):
        pytest.fail("Unchecked or blocked source reached generation")

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev, model_name="jev-1.13.0"))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(nano, model_name="openai:gpt-5-nano"))
    offline_model_resolution("openai:gpt-6-luna", FunctionModel(generate))
    queue = FakeResultQueue()
    process_task_message(build_parse_task().model_dump_json(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "failed"
    assert result["usage_incomplete"]
    assert len(result["usage"]) == len(responses)
    assert all(entry["model"] == "openai:gpt-5-nano" for entry in result["usage"])
    assert all(entry["cost_microdollars"] == 9 for entry in result["usage"])
    assert len(responses) == {"block": 1, "unavailable": 0, "invalid": 2}[mode]


@pytest.mark.parametrize("provider", ["jev", "nano"])
def test_overall_deadline_cancels_slow_screen_without_approval(offline_model_resolution, provider):
    """A short total budget cannot turn a hung primary or fallback into an approval."""
    import asyncio

    cancelled = []
    nano_calls = []

    async def slow(messages, info):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    async def jev(messages, info):
        if provider == "jev":
            return await slow(messages, info)
        raise RuntimeError("JEV unavailable")

    async def nano(messages, info):
        nano_calls.append(True)
        return await slow(messages, info)

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(nano))
    outcome = screen_user_text("Career notes", "typesafe:jev-1.13.0", .2)
    assert not outcome.allowed
    assert outcome.unchecked
    assert cancelled == [True]
    assert nano_calls == ([] if provider == "jev" else [True])


@pytest.mark.parametrize("provider", ["jev", "nano"])
def test_limits_propagate_without_more_recovery(offline_model_resolution, provider):
    """A usage cap from either classifier fails the task instead of being bypassed."""
    from pydantic_ai.exceptions import UsageLimitExceeded

    nano_calls = []

    def jev(messages, info):
        if provider == "jev":
            raise UsageLimitExceeded("Synthetic limit")
        raise RuntimeError("JEV unavailable")

    def nano(messages, info):
        nano_calls.append(True)
        raise UsageLimitExceeded("Synthetic fallback limit")

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(nano))
    with pytest.raises(UsageLimitExceeded):
        screen_user_text("Career notes", "typesafe:jev-1.13.0", 1)
    assert nano_calls == ([] if provider == "jev" else [True])


@pytest.mark.parametrize("provider", ["jev", "nano"])
def test_external_cancellation_is_preserved(offline_model_resolution, provider):
    """Caller cancellation propagates without invoking another classifier."""
    import asyncio

    from agents.user_text_screen_agent import screen_user_message_async
    from screening.screen_user_text import screen_user_text_async

    nano_calls = []

    async def exercise():
        started = asyncio.Event()

        async def wait(messages, info):
            started.set()
            await asyncio.Event().wait()

        async def jev(messages, info):
            if provider == "jev":
                return await wait(messages, info)
            raise RuntimeError("JEV unavailable")

        async def nano(messages, info):
            nano_calls.append(True)
            return await wait(messages, info)

        offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev))
        offline_model_resolution("openai:gpt-5-nano", FunctionModel(nano))
        task = asyncio.create_task(screen_user_text_async("Career notes", "typesafe:jev-1.13.0", 5,
            classify=screen_user_message_async))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(exercise())
    assert nano_calls == ([] if provider == "jev" else [True])


@pytest.mark.parametrize("primary_result", ["allow", "block", "missing-key"])
def test_successful_jev_and_missing_key_never_use_fallback(
    offline_model_resolution, monkeypatch, primary_result,
):
    """Recovery cannot replace successful judgments or unavailable configuration."""
    called = []

    def jev(messages, info):
        called.append(True)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": primary_result == "block", "harmful_request": False})],
            provider_details={"confidence": {"prompt_injection": 1, "harmful_request": 1}})

    def unexpected(messages, info):
        pytest.fail("Fallback must not run")

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(unexpected))
    if primary_result == "missing-key":
        monkeypatch.delenv("TYPESAFE_API_KEY")
    outcome = screen_user_text("Career notes", "typesafe:jev-1.13.0", 1)
    assert outcome.allowed == (primary_result == "allow")
    assert outcome.unchecked == (primary_result == "missing-key")
    assert len(called) == (0 if primary_result == "missing-key" else 1)


@pytest.mark.real_guardrail
@pytest.mark.parametrize("blocked", [False, True])
def test_async_guard_recovery_retains_real_fallback_cost(
    offline_model_resolution, monkeypatch, task_dependencies, blocked,
):
    """A direct unknown prompt uses async fallback before the generator and bills it once."""
    from pydantic_ai import Agent
    from pydantic_ai.messages import TextPart
    from pydantic_ai_harness import InputGuardrail

    from screening.prompt_guardrail import screen_prompt
    from tests.test_process_task_message import FakeResultQueue, build_task_body
    from worker import main
    from worker.queue_messages import AiResultMessage
    from worker.task_usage import accounted_model

    generated = []

    def jev(messages, info):
        raise RuntimeError("JEV outage")

    def nano(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": blocked, "harmful_request": False})],
            usage=RequestUsage(input_tokens=100, output_tokens=10))

    def generate(messages, info):
        generated.append(True)
        return ModelResponse(parts=[TextPart("ok")], usage=RequestUsage(input_tokens=200))

    def handler(task, dependencies):
        Agent(accounted_model("openai:gpt-6-luna"),
              capabilities=[InputGuardrail(guard=screen_prompt)]).run_sync("Career notes")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed")

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(jev))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(nano, model_name="openai:gpt-5-nano"))
    offline_model_resolution("openai:gpt-6-luna", FunctionModel(generate, model_name="openai:gpt-6-luna"))
    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == ("failed" if blocked else "completed")
    assert result["usage_incomplete"]
    assert generated == ([] if blocked else [True])
    assert result["usage"][0]["model"] == "openai:gpt-5-nano"
    assert result["usage"][0]["cost_microdollars"] == 9
    assert len(result["usage"]) == (1 if blocked else 2)
