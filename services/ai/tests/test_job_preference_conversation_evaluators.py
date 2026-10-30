"""Check synthetic preference labels and intentional priority/clarification failures."""
from types import SimpleNamespace

from evals.job_preference_conversation_evaluators import (
    PreferenceConversationOutcome,
    PreferenceConversationOutput,
)
from evals.run_job_preference_conversation_evals import load_preference_conversation_dataset


def test_expected_priorities_and_clarification_are_checked_without_provider_calls():
    dataset = load_preference_conversation_dataset()
    for case in dataset.cases:
        metadata = case.metadata
        output = PreferenceConversationOutput(proposal={"reply": "Review and confirm your draft.", "criteria": [
            {"text": term, "priority": priority} for term, priority in metadata.required.items()]},
            question="Is this required?" if metadata.requires_question else None)
        assert all(value == 1 for value in PreferenceConversationOutcome().evaluate(SimpleNamespace(metadata=metadata, output=output)).values())
    failed = output.model_copy(update={"question": "Unnecessary question"})
    assert PreferenceConversationOutcome().evaluate(SimpleNamespace(metadata=metadata, output=failed))["clarification_route"] == 0
    empty = output.model_copy(deep=True)
    empty.proposal.criteria = []
    assert PreferenceConversationOutcome().evaluate(SimpleNamespace(metadata=metadata, output=empty))["stated_preferences_and_priorities"] == 0


def test_runner_accepts_only_present_exact_passing_deterministic_scores(monkeypatch):
    import pytest

    from evals import run_job_preference_conversation_evals as runner

    keys = ("clarification_route", "stated_preferences_and_priorities", "unsupported_preferences_absent")
    passing = {key: SimpleNamespace(value=1.0) for key in keys}
    case = SimpleNamespace(evaluator_failures={}, scores=passing)
    report = SimpleNamespace(failures=[], cases=[case])
    monkeypatch.setattr(runner, "evaluate_dataset", lambda *_a, **_k: report)
    assert runner.run_preference_conversation_evals() is report
    for bad_scores in ({**passing, keys[0]: SimpleNamespace(value=0.0)},
            {key: value for key, value in passing.items() if key != keys[1]},
            {**passing, keys[2]: SimpleNamespace(value=float("nan"))}):
        case.scores = bad_scores
        with pytest.raises(RuntimeError, match="deterministic"):
            runner.run_preference_conversation_evals()
    report.cases = []
    with pytest.raises(RuntimeError, match="deterministic"):
        runner.run_preference_conversation_evals()
