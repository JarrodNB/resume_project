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
