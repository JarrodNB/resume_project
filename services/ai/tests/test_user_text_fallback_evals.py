"""Check fallback eval scoring with synthetic provider responses and real native reports."""

import json

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from evals import run_user_text_fallback_evals as runner
from evals.run_user_text_screen_evals import load_user_text_screen_dataset


def test_fallback_eval_uses_boolean_policy(offline_model_resolution, monkeypatch):
    """Hand labels score perfectly without any JEV confidence fields."""
    labels = {case.inputs.text: case.metadata for case in load_user_text_screen_dataset().cases}
    scores = {}

    def classify(messages, info):
        label = labels[json.loads(messages[-1].parts[-1].content)["text"]]
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "prompt_injection": label.prompt_injection,
            "harmful_request": label.harmful_request,
        })])

    offline_model_resolution("openai:gpt-5-nano", FunctionModel(classify))
    monkeypatch.setattr(runner, "record_score", lambda name, value: scores.update({name: value}))
    report = runner.run_user_text_fallback_evals()
    assert len(report.cases) == len(labels)
    assert scores == {"decision_match": 1, "prompt_injection_match": 1,
                      "harmful_request_match": 1, "case_errors": 0}


def test_fallback_eval_outages_are_errors(offline_model_resolution, monkeypatch):
    """Provider errors cannot score as successful detection of an attack."""
    scores = {}

    def unavailable(messages, info):
        raise RuntimeError("Synthetic provider outage")

    offline_model_resolution("openai:gpt-5-nano", FunctionModel(unavailable))
    monkeypatch.setattr(runner, "record_score", lambda name, value: scores.update({name: value}))
    with pytest.raises(RuntimeError, match="errors or incorrect decisions"):
        runner.run_user_text_fallback_evals()
    assert scores["case_errors"] == len(load_user_text_screen_dataset().cases)
    assert scores["decision_match"] == 0


def test_primary_eval_outages_cannot_report_success(offline_model_resolution):
    """The primary classifier suite must fail visibly when cases could not run."""
    from evals.run_user_text_screen_evals import run_user_text_screen_evals

    cases = load_user_text_screen_dataset().cases
    labels = {case.inputs.text: case.metadata for case in cases}

    def unavailable(messages, info):
        text = messages[-1].parts[-1].content
        if text == cases[0].inputs.text:
            raise RuntimeError("Synthetic JEV outage")
        label = labels[text]
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "prompt_injection": label.prompt_injection, "harmful_request": label.harmful_request,
        })], provider_details={"confidence": {"prompt_injection": 1, "harmful_request": 1}})

    offline_model_resolution("typesafe:jev-1.13.0", FunctionModel(unavailable))
    with pytest.raises(RuntimeError, match="errors or incorrect decisions"):
        run_user_text_screen_evals()
