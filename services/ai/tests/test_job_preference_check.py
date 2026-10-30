"""Verify independent preference probabilities and queue execution without paid models."""
from dataclasses import replace
from types import SimpleNamespace

import pytest


@pytest.fixture
def task_dependencies(task_dependencies):
    return replace(task_dependencies, read_preference_input=lambda task: task.input)

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


def model(probability=0.93):
    def answer(messages, info):
        tool = info.output_tools[0]
        return ModelResponse(parts=[ToolCallPart(tool.name, {"p1": probability})],
            model_name="jev-1.13.0", usage=RequestUsage(input_tokens=100, output_tokens=5))
    return FunctionModel(answer, model_name="jev-1.13.0")


def test_dispatch_returns_native_probability_with_frozen_identity(task_dependencies):
    task = SimpleNamespace(ai_task_id=uuid4(), user_id=uuid4(), task_type="check_job_preferences", input=snapshot())
    with job_preference_agent.override(model=model()):
        result = handle_ai_task(task, task_dependencies)
    assert result.status == "completed"
    outcome = result.result["listings"][0]["criteria"][0]
    assert outcome == {"id": task.input["criteria"][0]["id"], "probability": 0.93}
    assert set(result.result["listings"][0]) == {"id", "source_digest", "truncated", "criteria"}


def test_supported_criteria_still_report_a_truncated_source(task_dependencies):
    values = snapshot()
    values["listings"][0]["truncated"] = True
    with job_preference_agent.override(model=model()):
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
    assert result.result["listings"][0]["truncated"] is True
    assert result.result["listings"][0]["criteria"][0]["probability"] == 0.93


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


def test_probability_endpoints_are_preserved_without_thresholding(task_dependencies):
    values = snapshot()
    for probability in (0.0, 0.5, 1.0):
        with job_preference_agent.override(model=model(probability)):
            result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values), task_dependencies)
        assert result.result["listings"][0]["criteria"][0]["probability"] == probability


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
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"p1": 0.93})],
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
    assert "too many preference probabilities" in result.error_message
    assert result.result is None
    assert len(accounting.entries) == 1
    assert result.usage[0].input_tokens == 100


import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded

from schemas.job_preferences import PreferenceCheckInput


@pytest.mark.parametrize("probability", [-0.1, 1.1, float("nan"), float("inf"), "0.9", True])
def test_invalid_probability_never_becomes_a_match(task_dependencies, probability):
    from worker.job_preference_handler import handle_job_preference_check_task
    with job_preference_agent.override(model=model(probability)), pytest.raises(UnexpectedModelBehavior):
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
    assert result.result["listings"][0]["criteria"][0]["probability"] == 0.93


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


def test_dynamic_preferences_return_independent_raw_probabilities_without_passage_choices(task_dependencies):
    values = snapshot()
    values['criteria'].append({'id': str(uuid4()), 'text': 'Annual salary at least USD 150000', 'priority': 'nice_to_have'})
    seen = []
    def probabilities(messages, info):
        tool = info.output_tools[0]
        seen.append(tool.parameters_json_schema)
        return ModelResponse(parts=[ToolCallPart(tool.name, {'p1': 0.93, 'p2': 0.87})],
            model_name='jev-1.13.0', usage=RequestUsage(input_tokens=100, output_tokens=5))
    with job_preference_agent.override(model=FunctionModel(probabilities, model_name='jev-1.13.0')):
        result = handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type='check_job_preferences', input=values), task_dependencies)
    assert result.status == 'completed'
    assert result.result['listings'][0]['criteria'] == [
        {'id': values['criteria'][0]['id'], 'probability': 0.93},
        {'id': values['criteria'][1]['id'], 'probability': 0.87},
    ]
    assert set(seen[0]['properties']) == {'p1', 'p2'}
    assert all(field.get('type') == 'number' and field.get('minimum') == 0 and field.get('maximum') == 1
        for field in seen[0]['properties'].values())
    assert 'evidence_passages' not in result.result['listings'][0]


def test_dynamic_schema_uses_one_native_probability_question_per_preference():
    import asyncio

    from pydantic_ai import models
    from pydantic_ai.models.decision import (
        DecisionModel,
        DecisionResponse,
        NoulAnswer,
        NoulQuestion,
    )

    from agents.job_preference_agent import assess_preference_listing
    from schemas.job_preferences import PreferenceCheckInput

    class NativeProbabilityModel(DecisionModel):
        @property
        def model_name(self): return "jev-1.13.0"
        @property
        def system(self): return "typesafe"
        @property
        def base_url(self): return "https://synthetic.invalid"
        async def decide(self, request, model_settings):
            assert len(request.questions) == 10
            assert set(request.questions) == {f"p{i}" for i in range(1, 11)}
            assert all(isinstance(question, NoulQuestion) for question in request.questions.values())
            return DecisionResponse(answers={name: NoulAnswer(noul=0.91) for name in request.questions},
                model_name=self.model_name, usage=RequestUsage(input_tokens=100, output_tokens=0))
    values = snapshot()
    values['criteria'] = [{'id': str(uuid4()), 'text': f'Condition {i}', 'priority': 'must_have'} for i in range(10)]
    frozen = PreferenceCheckInput.model_validate(values)
    with models.override_allow_model_requests(True), job_preference_agent.override(model=NativeProbabilityModel()):
        result, _ = asyncio.run(assess_preference_listing(frozen.criteria, frozen.listings[0]))
    assert len(result['criteria']) == 10
    assert all(item['probability'] == 0.91 for item in result['criteria'])
    values['criteria'].append({'id': str(uuid4()), 'text': 'Eleventh', 'priority': 'must_have'})
    with pytest.raises(ValueError):
        PreferenceCheckInput.model_validate(values)


@pytest.mark.parametrize('output', [{}, {'p1': 0.9, 'p2': 0.8}])
def test_missing_or_extra_probability_fields_fail(task_dependencies, output):
    def answer(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)], model_name='jev-1.13.0')
    with job_preference_agent.override(model=FunctionModel(answer)), pytest.raises(UnexpectedModelBehavior):
        handle_ai_task(SimpleNamespace(ai_task_id=uuid4(), task_type='check_job_preferences', input=snapshot()), task_dependencies)


def test_schema_descriptions_mask_contacts_and_reject_zero_or_eleven_preferences():
    from agents.job_preference_agent import listing_decision_schema
    from privacy.contact_mask import contact_scope
    from privacy.known_contact import KnownContact
    criterion = SimpleNamespace(text='Work near Alice Example')
    with contact_scope(KnownContact.from_values(names=['Alice Example'])):
        schema = listing_decision_schema([criterion]).model_json_schema()
    assert 'Alice Example' not in str(schema)
    for criteria in ([], [criterion] * 11):
        with pytest.raises(ValueError, match='1–10'):
            listing_decision_schema(criteria)
