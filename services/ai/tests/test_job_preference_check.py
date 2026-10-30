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
    assert outcome["support"] == {"passage_id": "P1"}
    assert result.result["listings"][0]["evidence_passages"] == [{"passage_id": "P1", "text": "This job is fully remote within the US."}]


def test_supported_criteria_still_report_a_truncated_source(task_dependencies):
    values = snapshot()
    values["listings"][0]["truncated"] = True
    with job_preference_agent.override(model=model()):
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert result.result["listings"][0]["truncated"] is True
    assert result.result["listings"][0]["criteria"][0]["status"] == "matching"


def test_batch_returns_every_listing_with_separate_run_limits_and_shared_accounting(task_dependencies, offline_model_resolution):
    from llm.usage import collect_task_usage
    values = snapshot()
    values["listings"] += [{**values["listings"][0], "id": str(uuid4())} for _ in range(2)]
    offline_model_resolution("typesafe:jev-1.13.0", model())
    with collect_task_usage() as accounting:
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert result.status == "completed"
    assert [item["id"] for item in result.result["listings"]] == [item["id"] for item in values["listings"]]
    assert len(accounting.entries) == 3
    assert sum(entry.input_tokens for entry in accounting.entries) == 300


def test_compact_batch_keeps_each_exact_quote_once_and_references_only_known_passages(task_dependencies):
    values = snapshot()
    with job_preference_agent.override(model=model("P1", "P1")):
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    listing = result.result["listings"][0]
    assert listing["criteria"][0]["support"] == {"passage_id": "P1"}
    assert listing["criteria"][0]["contradiction"] == {"passage_id": "P1"}
    assert listing["evidence_passages"] == [{"passage_id": "P1", "text": values["listings"][0]["passages"][0]["text"]}]


def test_one_hundred_small_listings_remain_bounded_and_each_gets_one_decision(task_dependencies, offline_model_resolution):
    from llm.usage import collect_task_usage
    values = snapshot()
    values["listings"] += [{**values["listings"][0], "id": str(uuid4())} for _ in range(99)]
    offline_model_resolution("typesafe:jev-1.13.0", model())
    with collect_task_usage() as accounting:
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert result.status == "completed"
    assert len(result.result["listings"]) == 100
    assert len(accounting.entries) == 100
    assert len(result.model_dump_json().encode("utf-8")) < 240_000


def test_oversized_serialized_batch_is_rejected_before_any_model_request(task_dependencies, monkeypatch):
    values = snapshot()
    values["listings"] = [{**values["listings"][0], "id": str(uuid4()), "passages": [{"id": f"P{index + 1}", "text": "x" * 500} for index in range(16)]} for _ in range(100)]
    def forbidden(*args, **kwargs):
        raise AssertionError("Oversized input reached a model")
    monkeypatch.setattr("worker.job_preference_handler.assess_preference_listing", forbidden)
    assert handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies).status == "failed"


def test_batch_concurrency_is_bounded_and_all_runs_finish_before_return(task_dependencies, offline_model_resolution):
    import asyncio

    from worker.job_preference_handler import MAX_CONCURRENT_DECISIONS
    active = 0
    peak = 0
    async def answer(messages, info):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.001)
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"c0_support": "P1", "c0_contradiction": "none"})],
                model_name="jev-1.13.0", usage=RequestUsage(input_tokens=100, output_tokens=5))
        finally:
            active -= 1
    values = snapshot()
    values["listings"] += [{**values["listings"][0], "id": str(uuid4())} for _ in range(9)]
    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(answer, model_name="jev-1.13.0"))
    result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert result.status == "completed"
    assert peak == MAX_CONCURRENT_DECISIONS
    assert active == 0


def test_batch_request_budget_blocks_unpaid_work_but_preserves_known_charges(task_dependencies, offline_model_resolution, monkeypatch):
    from llm.usage import collect_task_usage
    monkeypatch.setattr("worker.job_preference_handler.MAX_MODEL_REQUESTS", 2)
    values = snapshot()
    values["listings"] += [{**values["listings"][0], "id": str(uuid4())} for _ in range(2)]
    offline_model_resolution("typesafe:jev-1.13.0", model())
    with collect_task_usage() as accounting, pytest.raises(UsageLimitExceeded):
        handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert len(accounting.entries) == 2
    assert sum(entry.input_tokens for entry in accounting.entries) == 200


def test_oversized_result_returns_a_small_failure_with_actual_usage(task_dependencies, offline_model_resolution, monkeypatch):
    from llm.usage import collect_task_usage
    monkeypatch.setattr("worker.job_preference_handler.MAX_RESULT_BYTES", 1)
    offline_model_resolution("typesafe:jev-1.13.0", model())
    with collect_task_usage() as accounting:
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=snapshot()), task_dependencies)
    assert result.status == "failed"
    assert "too much listing evidence" in result.error_message
    assert result.result is None
    assert len(accounting.entries) == 1
    assert result.usage[0].input_tokens == 100


import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded

from schemas.job_preferences import PreferenceCheckInput


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
    monkeypatch.setattr("screening.records.screen_user_text", forbidden)
    with job_preference_agent.override(model=model()):
        assert handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=snapshot()), task_dependencies).status == "completed"


def test_unknown_preference_and_listing_skip_injection_screening(task_dependencies, monkeypatch):
    values = snapshot()
    values["criteria"][0]["trusted_generated"] = False
    values["listings"][0]["screened"] = False
    def forbidden(*args, **kwargs):
        raise AssertionError("preference inputs must not be screened")
    monkeypatch.setattr("screening.records.screen_user_text", forbidden)
    monkeypatch.setattr("screening.prompt_guardrail.screen_user_text_async", forbidden)
    with job_preference_agent.override(model=model()):
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert result.status == "completed"
    assert result.result["listings"][0]["criteria"][0]["status"] == "matching"


def test_preference_input_guard_rejects_empty_and_oversized_prompts():
    import asyncio
    from agents.job_preference_agent import check_preference_input
    from text_limits import MAX_PROMPT_TEXT

    for prompt in ("", "x" * (MAX_PROMPT_TEXT + 1)):
        with pytest.raises(ValueError, match="bounded nonblank"):
            asyncio.run(check_preference_input(None, prompt))


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


def test_approved_independent_listings_do_not_share_a_prompt_cap_after_masking(task_dependencies):
    """A Rails-budget batch must survive masking when each listing prompt still fits."""
    from privacy.contact_mask import contact_scope
    from privacy.known_contact import KnownContact
    values = snapshot()
    text = "Description: " + "Ai " * 330
    passages = [{"id": f"P{index // 500 + 1}", "text": text[index:index + 500]}
                for index in range(0, len(text), 500)]
    assert len(text.encode()) <= 100_000 // 90
    values["listings"] = [{**values["listings"][0], "id": str(uuid4()), "passages": passages} for _ in range(90)]
    with contact_scope(KnownContact.from_values(names=["Ai"])), job_preference_agent.override(model=model()):
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert result.status == "completed", result.error_message
    assert len(result.result["listings"]) == 90
