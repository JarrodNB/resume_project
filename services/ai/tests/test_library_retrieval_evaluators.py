"""
Description: The library retrieval eval labels score 1.0 against their own cases, with no
embedding call.
Index:
    - test_hand_labels_get_perfect_scores
"""

from evals.library_retrieval_evaluators import labels_to_ranking
from evals.run_library_retrieval_evals import load_library_retrieval_dataset


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case the ranking its labels describe scores 1.0 everywhere."""
    dataset = load_library_retrieval_dataset()
    assert len(dataset.cases) >= 2

    def answer(case_input):
        """The hand-labelled ranking for this case."""
        labels = next(case.metadata for case in dataset.cases if case.inputs == case_input)
        assert labels is not None
        return labels_to_ranking(labels)

    report = dataset.evaluate_sync(answer, progress=False)

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores
