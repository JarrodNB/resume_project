"""Exercise execution-local screening through real fake-provider boundaries."""

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RunUsage

from agents.user_text_screen_agent import user_text_screen_agent
from screening.screen_user_text import screen_user_text
from screening.session import bind_screened_prompt, screening_session

pytestmark = pytest.mark.real_guardrail


@pytest.fixture
def classifier(monkeypatch):
    """Record real classifier requests and deterministically flag a synthetic attack."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", "2000")
    seen = []

    def classify(messages, info):
        text = messages[-1].parts[-1].content
        seen.append(text)
        if "outage" in text:
            raise RuntimeError("Synthetic provider outage")
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {
                "prompt_injection": "attack" in text, "harmful_request": False,
            })],
            model_name="jev-1.13.0", usage=RunUsage(input_tokens=10),
            provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}},
        )

    with user_text_screen_agent.override(model=FunctionModel(classify)):
        yield seen


def test_large_source_is_screened_in_overlapping_chunks(monkeypatch):
    """An ordinary long resume is split before Jev receives it."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", "2000")
    seen = []

    def classify(messages, info):
        seen.append(messages[-1].parts[-1].content)
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {
                "prompt_injection": False, "harmful_request": False,
            })],
            model_name="jev-1.13.0", usage=RunUsage(input_tokens=10),
            provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}},
        )

    source = "0123456789" * 450
    with user_text_screen_agent.override(model=FunctionModel(classify)):
        result = screen_user_text(source, "typesafe:jev-1.13.0", 5, check_phrases=False)
    assert result.allowed
    assert [len(chunk) for chunk in seen] == [2000, 2000, 1100]
    assert seen[0][-300:] == seen[1][:300]
    assert result.usage.input_tokens == 30


@pytest.mark.parametrize("size,expected", [(2000, [2000, 2000, 1100]), (4000, [4000, 800])])
def test_both_candidates_cover_every_character(size, expected, monkeypatch, classifier):
    """Joining chunks after removing overlap exactly recovers the original document."""
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", str(size))
    source = "0123456789" * 450
    result = screen_user_text(source, "typesafe:jev-1.13.0", 5, check_phrases=False)
    assert result.allowed
    assert [len(chunk) for chunk in classifier] == expected
    assert classifier[0] + "".join(chunk[300:] for chunk in classifier[1:]) == source


def test_identical_policy_reuses_only_within_execution(classifier):
    """Reuse avoids a second call and duplicate billed aggregate; next delivery checks again."""
    for _delivery in range(2):
        with screening_session():
            first = screen_user_text("Career source", "typesafe:jev-1.13.0", 5)
            second = screen_user_text("Career source", "typesafe:jev-1.13.0", 5)
            assert first.usage.input_tokens == 10
            assert second.allowed and second.usage is None
    assert len(classifier) == 2


def test_changed_content_or_policy_requires_new_decision(classifier):
    """A prior approval is scoped to the exact source and phrase policy."""
    with screening_session():
        screen_user_text("Career source", "typesafe:jev-1.13.0", 5)
        screen_user_text("Career source changed", "typesafe:jev-1.13.0", 5)
        screen_user_text("Career source", "typesafe:jev-1.13.0", 5, check_phrases=False)
    assert len(classifier) == 3


@pytest.mark.parametrize("suffix,unchecked", [("attack", False), ("outage", True)])
def test_late_failure_keeps_earlier_billed_chunks(suffix, unchecked, classifier):
    """A later failure blocks the source while preserving completed Jev usage."""
    source = "x" * 2200 + suffix
    result = screen_user_text(source, "typesafe:jev-1.13.0", 5, check_phrases=False)
    assert not result.allowed
    assert result.unchecked is unchecked
    assert result.usage.input_tokens == (10 if unchecked else 20)
    assert len(classifier) == 2


def test_resume_handler_screens_source_once_then_generates(
    task_dependencies, fake_file_storage, classifier, offline_resume_model_resolution,
):
    """The handler and real parsing agent share coverage, rather than screening the wrapper."""
    from pydantic_ai.models.test import TestModel

    from tests.fakes import build_docx_bytes
    from tests.test_task_handlers import FILE_KEY, build_parse_resume_task
    from worker.task_handlers import handle_ai_task

    fake_file_storage.files[FILE_KEY] = build_docx_bytes(["Jane Doe", "Engineer at Acme"])
    offline_resume_model_resolution(TestModel())
    result = handle_ai_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "completed"
    assert len(classifier) == 1
    assert "Jane Doe" not in classifier[0]
    assert "«pii:" in classifier[0] and "Acme" in classifier[0]
    assert "<resume>" not in classifier[0]
    assert sum(item.input_tokens for item in result.usage if "jev" in item.model) == 10


def test_bound_prompt_does_not_hide_unknown_history(classifier):
    """Exact current-prompt coverage cannot approve an unrelated supplied history."""
    from pydantic_ai import Agent
    from pydantic_ai.messages import ModelRequest, UserPromptPart
    from pydantic_ai.models.test import TestModel
    from pydantic_ai_harness import InputBlocked, InputGuardrail

    from screening.prompt_guardrail import screen_prompt

    agent = Agent(TestModel(), capabilities=[InputGuardrail(guard=screen_prompt)])
    with screening_session():
        screen_user_text("Career source", "typesafe:jev-1.13.0", 5)
        prompt = bind_screened_prompt(["Career source"], lambda values: f"Read: {values[0]}")
        with pytest.raises(InputBlocked):
            agent.run_sync(prompt, message_history=[ModelRequest(parts=[UserPromptPart("attack")])])
    assert classifier == ["Career source", "attack"]


def test_changed_prompt_cannot_reuse_exact_binding(classifier):
    """Appending new untrusted input invalidates coverage instead of subtracting a substring."""
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel
    from pydantic_ai_harness import InputBlocked, InputGuardrail

    from screening.prompt_guardrail import screen_prompt

    agent = Agent(TestModel(), capabilities=[InputGuardrail(guard=screen_prompt)])
    with screening_session():
        screen_user_text("Career source", "typesafe:jev-1.13.0", 5)
        prompt = bind_screened_prompt(["Career source"], lambda values: f"Read: {values[0]}")
        with pytest.raises(InputBlocked):
            agent.run_sync(prompt + " attack")
    assert classifier == ["Career source", "Read: Career source attack"]


def test_empty_or_unchecked_sources_cannot_bind(classifier):
    """Calling the binder itself is never evidence that screening succeeded."""
    from screening.session import prompt_is_covered

    with screening_session():
        assert not prompt_is_covered(bind_screened_prompt([], lambda _: "attack"))
        assert not prompt_is_covered(bind_screened_prompt(["attack"], lambda values: values[0]))


def test_covered_prompt_still_obeys_complete_prompt_length_cap(classifier):
    """Coverage never exempts trusted scaffolding from the overall generation size cap."""
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel
    from pydantic_ai_harness import InputBlocked, InputGuardrail

    from screening.prompt_guardrail import TOO_LONG_MESSAGE, screen_prompt
    from text_limits import MAX_PROMPT_TEXT

    agent = Agent(TestModel(), capabilities=[InputGuardrail(guard=screen_prompt)])
    with screening_session():
        screen_user_text("Career source", "typesafe:jev-1.13.0", 5)
        prompt = bind_screened_prompt(
            ["Career source"], lambda values: ("x" * MAX_PROMPT_TEXT) + values[0],
        )
        with pytest.raises(InputBlocked, match=TOO_LONG_MESSAGE):
            agent.run_sync(prompt)
    assert classifier == ["Career source"]


def test_nested_concurrent_execution_scopes_isolate_decisions(classifier):
    """Concurrent worker execution scopes cannot reuse one another's decisions."""
    import contextvars
    from concurrent.futures import ThreadPoolExecutor

    contexts = [contextvars.copy_context(), contextvars.copy_context()]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(context.run, _one_execution) for context in contexts]
        for future in futures:
            future.result()

    assert len(classifier) == 2


def _one_execution():
    with screening_session():
        screen_user_text("Career source", "typesafe:jev-1.13.0", 5)
        screen_user_text("Career source", "typesafe:jev-1.13.0", 5)


def test_concurrent_same_source_has_one_classifier_request(monkeypatch):
    """Two writers requesting the same source wait for one actual policy decision."""
    import asyncio

    from agents.user_text_screen_agent import UserTextScreenRun
    from schemas.user_text_screen import UserTextScreen
    from screening.screen_user_text import screen_user_text_async

    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")

    async def run():
        seen = []
        entered = asyncio.Event()
        release = asyncio.Event()

        async def classify(text, model, timeout):
            seen.append(text)
            entered.set()
            await release.wait()
            return UserTextScreenRun(UserTextScreen(prompt_injection=False, harmful_request=False),
                model, {"prompt_injection": 1., "harmful_request": 1.}, RunUsage(input_tokens=10))

        with screening_session():
            first = asyncio.create_task(screen_user_text_async("Shared evidence", "typesafe:jev-1.13.0", 5, classify=classify))
            await entered.wait()
            second = asyncio.create_task(screen_user_text_async("Shared evidence", "typesafe:jev-1.13.0", 5, classify=classify))
            # Give the duplicate caller a turn before releasing the classifier.
            await asyncio.sleep(0)
            release.set()
            results = await asyncio.gather(first, second)
        assert seen == ["Shared evidence"]
        assert all(result.allowed for result in results)
        assert sum(result.usage.input_tokens for result in results if result.usage) == 10
    asyncio.run(run())


def test_projected_source_requires_the_exact_checked_text() -> None:
    """A serialized source cannot gain coverage from a different screened projection."""
    from types import SimpleNamespace

    from screening.session import approve_projected_source, prompt_is_covered, screening_session

    source = '{"title":"Engineer"}'
    project = lambda _: "Job title:\nEngineer"
    with screening_session():
        with pytest.raises(ValueError):
            approve_projected_source(source, "Job title:\nDesigner", project, SimpleNamespace(allowed=True))
        with pytest.raises(ValueError):
            approve_projected_source(source, project(source), project, SimpleNamespace(allowed=False))
        approve_projected_source(source, project(source), project, SimpleNamespace(allowed=True))
        assert bind_screened_prompt([source], lambda values: values[0]) == source
        assert prompt_is_covered(source)
