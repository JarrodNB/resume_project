"""Ensure synthetic evaluation cannot award invented evidence or outages a passing score."""
from types import SimpleNamespace

from evals.job_preference_evaluators import (
    PreferenceEvalInput,
    PreferenceEvalLabels,
    PreferenceEvalOutput,
    PreferenceOutcome,
)
from evals.run_job_preference_evals import load_job_preference_dataset


def test_grounded_match_passes_and_fabricated_quote_fails():
    decision = {"status": "matching", "support": {"passage_id": "P1", "text": "Fully remote."}, "contradiction": None}
    ctx = SimpleNamespace(inputs=PreferenceEvalInput(criterion="Fully remote", passages=["Fully remote."]),
        metadata=PreferenceEvalLabels(status="matching", support="P1"),
        output=PreferenceEvalOutput(status="completed", decision=decision))
    assert PreferenceOutcome().evaluate(ctx) == {"decision_match": 1.0, "evidence_valid": 1.0}
    ctx.output.decision["support"]["text"] = "Invented"
    assert PreferenceOutcome().evaluate(ctx)["evidence_valid"] == 0.0


def test_screening_outage_is_not_a_successful_injection_block():
    ctx = SimpleNamespace(inputs=PreferenceEvalInput(criterion="Remote", passages=["Injected"]),
        metadata=PreferenceEvalLabels(status="failed", blocked=True),
        output=PreferenceEvalOutput(status="failed", failure_code="screening_unavailable"))
    assert PreferenceOutcome().evaluate(ctx)["decision_match"] == 0.0
    ctx.output.failure_code = "input_rejected"
    assert PreferenceOutcome().evaluate(ctx)["decision_match"] == 1.0


def test_dataset_contains_only_eight_bounded_synthetic_cases_with_expected_labels_separate():
    cases = load_job_preference_dataset().cases
    assert len(cases) == 8
    assert sum(case.metadata.blocked for case in cases) == 1
    assert {case.metadata.status for case in cases} == {"matching", "conflicting", "unknown", "failed"}
    assert all("status" not in case.inputs.model_dump() for case in cases)
