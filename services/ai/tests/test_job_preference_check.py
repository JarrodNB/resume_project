"""Verify criterion outcomes, grounded evidence and queue execution without paid models."""
from types import SimpleNamespace
from uuid import uuid4

from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from agents.job_preference_agent import job_preference_agent
from worker.task_handlers import handle_ai_task


def snapshot():
    return {"profile_id": str(uuid4()), "confirmed_revision": 2,
        "criteria": [{"id": str(uuid4()), "text": "Fully remote", "priority": "must_have", "trusted_generated": True}],
        "listings": [{"id": str(uuid4()), "source_digest": "a" * 64, "truncated": False, "screened": True,
            "passages": [{"id": "P1", "text": "This job is fully remote within the US."}]}]}


def model(support="P1", contradiction="none"):
    def answer(messages, info):
        tool = info.output_tools[0]
        return ModelResponse(parts=[ToolCallPart(tool.name, {"c0_support": support, "c0_contradiction": contradiction})],
            model_name="jev-1.13.0", usage=RequestUsage(input_tokens=100, output_tokens=5))
    return FunctionModel(answer, model_name="jev-1.13.0")


def test_dispatch_returns_exact_frozen_evidence(task_dependencies):
    task = SimpleNamespace(ai_task_id=uuid4(), user_id=uuid4(), task_type="check_job_preferences", input=snapshot())
    with job_preference_agent.override(model=model()):
        result = handle_ai_task(task, task_dependencies)
    assert result.status == "completed"
    outcome = result.result["listings"][0]["criteria"][0]
    assert outcome["status"] == "matching"
    assert outcome["support"] == {"passage_id": "P1", "text": "This job is fully remote within the US."}


import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.usage import RunUsage

from schemas.job_preferences import PreferenceCheckInput
from screening.screen_user_text import ScreenOutcome


@pytest.mark.parametrize("support,conflict,status,reason", [
    ("none", "none", "unknown", "not_stated"),
    ("none", "P1", "conflicting", "contradicted"),
    ("P1", "P1", "unknown", "contradictory_evidence"),
])
def test_missing_and_conflicting_evidence_are_different(task_dependencies, support, conflict, status, reason):
    task = SimpleNamespace(ai_task_id=uuid4(), input=snapshot())
    from worker.job_preference_handler import handle_job_preference_check_task
    with job_preference_agent.override(model=model(support, conflict)):
        result = handle_job_preference_check_task(task, task_dependencies)
    decision = result.result["listings"][0]["criteria"][0]
    assert (decision["status"], decision["reason"]) == (status, reason)


def test_invalid_passage_id_never_becomes_a_supported_match(task_dependencies):
    from worker.job_preference_handler import handle_job_preference_check_task
    with job_preference_agent.override(model=model("P900")), pytest.raises(UnexpectedModelBehavior):
        handle_job_preference_check_task(SimpleNamespace(ai_task_id=uuid4(), input=snapshot()), task_dependencies)


def test_generated_and_previously_checked_sources_are_not_screened_again(task_dependencies, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("source with Rails-owned provenance was screened again")
    monkeypatch.setattr("worker.job_preference_handler.screen_user_text", forbidden)
    with job_preference_agent.override(model=model()):
        assert handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=snapshot()), task_dependencies).status == "completed"


def test_unknown_sources_are_screened_and_rejection_is_not_an_unknown_decision(task_dependencies, monkeypatch):
    values = snapshot()
    values["criteria"][0]["trusted_generated"] = False
    seen = []
    def reject(text, **kwargs):
        seen.append(text)
        return ScreenOutcome(allowed=False)
    monkeypatch.setattr("worker.job_preference_handler.screen_user_text", reject)
    result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert seen == ["Fully remote"]
    assert result.status == "failed"
    assert result.result == {"failure_code": "input_rejected"}


def test_overlarge_and_duplicate_inputs_fail_before_model_work(task_dependencies):
    values = snapshot()
    values["listings"].append(values["listings"][0])
    assert handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies).status == "failed"
    values = snapshot()
    values["criteria"].append(values["criteria"][0])
    with pytest.raises(ValueError, match="Repeated preference"):
        PreferenceCheckInput.model_validate(values)


def test_accounting_records_actual_decision_model_and_usage(task_dependencies, offline_model_resolution):
    from llm.usage import collect_task_usage
    offline_model_resolution("typesafe:jev-1.13.0", model())
    with collect_task_usage() as accounting:
        handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=snapshot()), task_dependencies)
    assert len(accounting.entries) == 1
    assert accounting.entries[0].model == "jev-1.13.0"
    assert accounting.entries[0].input_tokens == 100


def test_task_wide_screening_chunk_budget_stops_additional_work(task_dependencies, monkeypatch):
    from screening.screen_user_text import _record_chunk_attempt
    values = snapshot()
    values["criteria"][0]["trusted_generated"] = False
    def too_many_chunks(*args, **kwargs):
        for _ in range(17):
            _record_chunk_attempt()
        return ScreenOutcome(allowed=True, usage=RunUsage(input_tokens=1), model="jev-1.13.0")
    monkeypatch.setattr("worker.job_preference_handler.screen_user_text", too_many_chunks)
    with pytest.raises(UsageLimitExceeded, match="screening request budget"):
        handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)


def test_shared_budget_counts_actual_validation_retries_and_preserves_paid_usage():
    import asyncio

    from pydantic_ai import Agent

    from llm.usage import accounted_model, collect_task_usage, model_request_budget
    attempts = []
    def invalid(messages, info):
        attempts.append(1)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"response": "not a boolean"})],
            model_name="jev-1.13.0", usage=RequestUsage(input_tokens=20, output_tokens=1))
    async def execute():
        agent = Agent(output_type=bool, retries=2)
        return await agent.run("Synthetic decision", model=accounted_model(FunctionModel(invalid, model_name="jev-1.13.0")))
    with collect_task_usage() as accounting, model_request_budget(request_limit=1, token_limit=1000), pytest.raises(UsageLimitExceeded):
        asyncio.run(execute())
    assert attempts == [1]
    assert len(accounting.entries) == 1
    assert accounting.entries[0].input_tokens == 20
    assert accounting.incomplete is False
