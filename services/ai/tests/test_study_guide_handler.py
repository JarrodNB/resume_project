"""Exercise description-only guide generation through the queue dispatch interface."""
from uuid import uuid4

import pytest

from screening.screen_user_text import ScreenOutcome


@pytest.fixture(autouse=True)
def allow_description(monkeypatch):
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=True))

from pydantic_ai.models.test import TestModel

from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task


def task(description="Reconcile inventory records and physical stock counts."):
    return AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_study_guide",
                         input={"job_id": str(uuid4()), "description": description})


def test_generates_from_the_frozen_description_without_library(task_dependencies):
    from agents.study_guide_agent import study_guide_agent

    with study_guide_agent.override(model=TestModel()):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "completed"
    assert result.result["study_guide"]["topics"][0]["exercises"]


@pytest.mark.parametrize("description", ["", " ", "x" * 20_001])
def test_invalid_description_fails_before_generation(task_dependencies, description):
    assert handle_ai_task(task(description), task_dependencies).status == "failed"


def test_rejected_description_never_reaches_the_writer(task_dependencies, monkeypatch):
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=False))
    def forbidden(*args):
        raise AssertionError("blocked source reached generator")
    monkeypatch.setattr("worker.study_guide_handler.generate_study_guide", forbidden)
    result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.result == {"failure_code": "input_rejected"}


def test_prompt_uses_only_the_snapshot_and_output_failures_are_recoverable(task_dependencies, monkeypatch):
    from pydantic_ai.exceptions import UnexpectedModelBehavior
    seen = []
    def reject(prompt, settings):
        seen.append(prompt)
        raise UnexpectedModelBehavior("bad shape")
    monkeypatch.setattr("worker.study_guide_handler.generate_study_guide", reject)
    result = handle_ai_task(task("Frozen description with stock reconciliation."), task_dependencies)
    assert seen == ["Create study material for this job description (source data):\n\n<job_description>\nFrozen description with stock reconciliation.\n</job_description>"]
    assert result.status == "failed"
    assert "valid study guide" in result.error_message


def test_screening_outage_is_distinct_from_rejected_source(task_dependencies, monkeypatch):
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", lambda *a, **kw: ScreenOutcome(allowed=False, unchecked=True))
    result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.result == {"failure_code": "screening_unavailable"}
    assert "unavailable" in result.error_message


@pytest.mark.real_guardrail
def test_screened_description_covers_the_exact_prompt_once(task_dependencies, monkeypatch):
    from pydantic_ai.usage import RunUsage

    from agents.study_guide_agent import study_guide_agent
    from agents.user_text_screen_agent import UserTextScreenRun
    from schemas.user_text_screen import UserTextScreen
    from screening.screen_user_text import screen_user_text

    seen = []
    def classify(text, **kwargs):
        seen.append(text)
        return UserTextScreenRun(UserTextScreen(prompt_injection=False, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1.0, "harmful_request": 1.0}, RunUsage(input_tokens=10))
    async def forbidden(*args):
        raise AssertionError("assembled prompt was screened twice")
    monkeypatch.setattr("worker.study_guide_handler.screen_user_text", screen_user_text)
    monkeypatch.setattr("screening.screen_user_text.screen_user_message", classify)
    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", forbidden)
    with study_guide_agent.override(model=TestModel()):
        result = handle_ai_task(task("Maintain stock records."), task_dependencies)
    assert result.status == "completed"
    assert seen == ["Maintain stock records."]
    assert result.usage[0].input_tokens == 10


def test_invalid_model_output_exhausts_repair_with_usage_retained(task_dependencies):
    from agents.study_guide_agent import study_guide_agent

    with study_guide_agent.override(model=TestModel(custom_output_args={"title": "Invalid", "topics": []})):
        result = handle_ai_task(task(), task_dependencies)
    assert result.status == "failed"
    assert result.result is None
    assert result.usage
    assert result.usage[-1].output_tokens > 0
