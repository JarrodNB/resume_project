"""
Description: The tailoring eval labels score 1.0 against their own cases, with no model call.
Index:
    - test_hand_labels_get_perfect_scores
"""

from evals.run_tailoring_evals import load_tailoring_dataset
from evals.tailoring_evaluators import labels_to_draft


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case the draft its labels describe scores 1.0 everywhere."""
    dataset = load_tailoring_dataset()
    assert len(dataset.cases) >= 8

    def answer(case_input):
        """The hand-labelled draft for this case."""
        labels = next(case.metadata for case in dataset.cases if case.inputs == case_input)
        assert labels is not None
        return labels_to_draft(labels)

    report = dataset.evaluate_sync(answer, progress=False)

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores
