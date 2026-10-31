"""Keep probability evaluation failures visible without claiming calibration."""
from types import SimpleNamespace

import pytest

from evals.job_preference_evaluators import (
    PreferenceEvalInput,
    PreferenceEvalLabels,
    PreferenceEvalOutput,
    PreferenceOutcome,
)
from evals.run_job_preference_evals import (
    BatchSmokeOutcome,
    _check_report,
    load_job_preference_batch_smoke_dataset,
    load_job_preference_dataset,
)


def test_native_probability_passes_only_its_expected_directional_band():
    ctx = SimpleNamespace(inputs=PreferenceEvalInput(criterion="Fully remote", passages=["Fully remote."]),
        metadata=PreferenceEvalLabels(minimum=0.75, maximum=1), output=PreferenceEvalOutput(status="completed", probability=0.93))
    assert PreferenceOutcome().evaluate(ctx) == {"probability_valid": 1.0, "expected_band": 1.0}
    ctx.output.probability = 0.1
    assert PreferenceOutcome().evaluate(ctx) == {"probability_valid": 1.0, "expected_band": 0.0}


def test_outage_or_missing_probability_is_not_a_successful_estimate():
    ctx = SimpleNamespace(inputs=None, metadata=PreferenceEvalLabels(minimum=0, maximum=1), output=PreferenceEvalOutput(status="failed"))
    assert PreferenceOutcome().evaluate(ctx) == {"probability_valid": 0.0, "expected_band": 0.0}


def test_dataset_bands_are_separate_from_model_inputs():
    cases = load_job_preference_dataset().cases
    assert len(cases) == 8
    assert all(set(case.inputs.model_dump()) == {"criterion", "passages"} for case in cases)
    assert all(0 <= case.metadata.minimum <= case.metadata.maximum <= 1 for case in cases)


def test_smoke_verifies_independent_scores_order_and_ten_preference_boundary():
    cases = load_job_preference_batch_smoke_dataset().cases
    assert len(cases) == 2
    assert [len(case.inputs["criteria"]) for case in cases] == [3, 10]
    ctx = SimpleNamespace(metadata=cases[0].metadata, output={"probabilities": [[0.95] * 3, [0.05] * 3, [0.5] * 3], "order": [0, 2, 1]})
    assert all(value == 1 for value in BatchSmokeOutcome().evaluate(ctx).values())
    ctx.output["order"] = [1, 2, 0]
    assert BatchSmokeOutcome().evaluate(ctx)["order_match"] == 0
    ctx.output["probabilities"][0] = [0.3] * 3
    assert BatchSmokeOutcome().evaluate(ctx)["independent"] == 0


@pytest.mark.parametrize("value", [None, float("nan"), 0.0])
def test_eval_gate_fails_for_missing_nan_or_nonpassing_score(value):
    scores = {} if value is None else {"probability_valid": SimpleNamespace(value=value)}
    report = SimpleNamespace(cases=[SimpleNamespace(evaluator_failures=[], scores=scores)], failures=[])
    with pytest.raises(RuntimeError):
        _check_report(report, ("probability_valid",))


def test_synthetic_runner_uses_explicit_hydration_without_database_or_provider(monkeypatch):
    from types import SimpleNamespace

    from agents.job_preference_agent import job_preference_agent
    from evals import run_job_preference_evals as runner
    from tests.test_job_preference_check import model
    monkeypatch.setattr(runner, "load_settings", lambda: SimpleNamespace())
    costs = []
    with job_preference_agent.override(model=model()):
        result = runner._execute(runner._task([("Fully remote", "must_have")], [["Remote role"]]), costs)
    assert result.status == "completed"
    assert result.result["listings"][0]["criteria"][0]["probability"] == 0.93
    assert len(costs) == 1
