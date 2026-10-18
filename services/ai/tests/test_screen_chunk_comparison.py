"""Verify comparison fairness, actual provider counts, and separate outage reporting offline."""

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from evals.run_screen_chunk_comparison import (
    ComparisonInput,
    ResumeCase,
    build_resume_cases,
    evaluate_case,
    summarize_results,
)
from worker.settings import load_settings


def fake_jev(requests, *, error=False, block=False):
    async def answer(messages, info):
        text = next(part.content for part in messages[-1].parts if isinstance(part, UserPromptPart))
        requests.append(text)
        if error:
            raise RuntimeError("synthetic outage")
        return ModelResponse(
            parts=[ToolCallPart(tool_name=info.output_tools[0].name, args={
                "prompt_injection": block, "harmful_request": False,
            })],
            model_name="jev-1.13.0", usage=RequestUsage(input_tokens=100, output_tokens=1),
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}},
        )
    return FunctionModel(answer, model_name="jev-1.13.0")


def test_synthetic_cases_include_benign_security_and_precise_boundaries():
    cases = build_resume_cases()
    assert 12 <= len(cases) <= 18
    assert len({case.name for case in cases}) == len(cases)
    benign = [case for case in cases if not case.expected_block]
    assert {case.name for case in benign} >= {"one_page", "two_pages", "long_resume", "security_career"}
    for boundary in (2000, 4000, 3700, 7700):
        case = next(case for case in cases if case.name == f"attack_boundary_{boundary}")
        assert case.attack_start < boundary < case.attack_end
        assert case.expected_block


def test_comparison_uses_same_text_and_counts_actual_requests(offline_model_resolution):
    requests = []
    offline_model_resolution(load_settings().user_text_screen_model, fake_jev(requests))
    resume = ResumeCase(name="benign", text="Built reliable Python services. " * 160, expected_block=False)
    outputs = []
    for config, expected in (("2000", 3), ("4000", 2), ("whole", 1)):
        requests.clear()
        output = evaluate_case(ComparisonInput(resume=resume, configuration=config))
        outputs.append(output)
        assert output.decision == "allowed"
        assert output.request_count == len(requests) == expected
        assert output.input_tokens == expected * 100
        assert output.cost_microdollars is not None
        if config == "whole":
            assert requests == [resume.text]
        else:
            assert requests[0] == resume.text[:int(config)]
            assert requests[0][-300:] == requests[1][:300]
    assert len({output.document_sha256 for output in outputs}) == 1


@pytest.mark.parametrize("configuration", ["2000", "4000", "whole"])
def test_outage_is_never_counted_as_detection(configuration, offline_model_resolution):
    requests = []
    offline_model_resolution(load_settings().user_text_screen_model, fake_jev(requests, error=True))
    offline_model_resolution(load_settings().user_text_screen_fallback_model, fake_jev([], error=True))
    resume = ResumeCase(name="attack", text="A synthetic embedded attack.", expected_block=True)
    output = evaluate_case(ComparisonInput(resume=resume, configuration=configuration))
    assert output.decision == "error"
    assert output.request_count == (1 if configuration == "whole" else 2)
    assert output.error
    summary = summarize_results([output])[configuration]
    assert summary["errors"] == 1
    assert summary["missed_attacks"] == 0
    assert summary["detected_attacks"] == 0


def test_wrong_decisions_are_reported_separately(offline_model_resolution):
    requests = []
    offline_model_resolution(load_settings().user_text_screen_model, fake_jev(requests, block=True))
    benign = ResumeCase(name="benign", text="A normal career.", expected_block=False)
    output = evaluate_case(ComparisonInput(resume=benign, configuration="2000"))
    assert summarize_results([output])["2000"]["false_positives"] == 1


def test_complete_json_is_written_on_case_errors(monkeypatch, tmp_path, offline_model_resolution):
    import json
    from types import SimpleNamespace

    from evals import run_screen_chunk_comparison as comparison

    offline_model_resolution(load_settings().user_text_screen_model, fake_jev([], error=True))

    def offline_dataset(load, judge, **kwargs):
        for case in load().cases:
            judge(case.inputs)
        return SimpleNamespace(failures=[])

    monkeypatch.setattr(comparison, "evaluate_dataset", offline_dataset)
    output_path = tmp_path / "comparison.json"
    report = comparison.run_screen_chunk_comparison(output_path)
    persisted = json.loads(output_path.read_text())
    assert not report["passed"]
    assert persisted == report
    assert len(report["results"]) == 42
    assert all(summary["errors"] == 14 for summary in report["summaries"].values())
    assert all(summary["detected_attacks"] == 0 for summary in report["summaries"].values())


def test_temporary_hooks_and_candidate_setting_restore_after_errors(monkeypatch, offline_model_resolution):
    import os

    from worker import task_usage

    previous_observer = task_usage.observe_request
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", "4000")
    offline_model_resolution(load_settings().user_text_screen_model, fake_jev([], error=True))
    resume = ResumeCase(name="benign", text="Normal experience.", expected_block=False)
    evaluate_case(ComparisonInput(resume=resume, configuration="2000"))
    assert task_usage.observe_request is previous_observer
    assert os.environ["USER_TEXT_SCREEN_CHUNK_SIZE"] == "4000"


def test_native_dataset_lifecycle_keeps_typed_outputs(offline_model_resolution):
    from evals.run_screen_chunk_comparison import load_comparison_dataset

    requests = []
    offline_model_resolution(load_settings().user_text_screen_model, fake_jev(requests))
    dataset = load_comparison_dataset()
    dataset.cases = dataset.cases[:1]
    report = dataset.evaluate_sync(evaluate_case, max_concurrency=1)
    assert not report.failures
    assert report.cases[0].output.request_count == 2
    assert report.cases[0].output.name == "one_page"


def test_missed_attack_is_explicit(offline_model_resolution):
    offline_model_resolution(load_settings().user_text_screen_model, fake_jev([]))
    attack = ResumeCase(name="attack", text="Synthetic attack text", expected_block=True)
    output = evaluate_case(ComparisonInput(resume=attack, configuration="whole"))
    assert summarize_results([output])["whole"]["missed_attacks"] == 1
