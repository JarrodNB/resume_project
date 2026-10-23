"""
Description: The library retrieval eval labels score 1.0 against their own cases, with no
embedding call.
Index:
    - test_hand_labels_get_perfect_scores
    - test_retrieval_scores_count_hits_inside_k
"""

from evals.library_retrieval_evaluators import labels_to_ranking, retrieval_scores
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


def test_eval_ranker_keeps_every_document_with_offline_embeddings() -> None:
    """The evaluation adapter calls the production interface without dropping candidates."""
    from pydantic_ai.embeddings import TestEmbeddingModel

    from evals.run_library_retrieval_evals import rank_library

    for case in load_library_retrieval_dataset().cases:
        result = rank_library(case.inputs, TestEmbeddingModel(dimensions=16), 16)
        assert sorted(result.ids) == sorted(document.id for document in case.inputs.documents)


def test_retrieval_scores_count_hits_inside_k() -> None:
    """A relevant id in second place is full recall, half precision, and MRR 1/2."""
    scores = retrieval_scores(["other", "hit"], ["hit"], k=8)

    assert scores == {"recall": 1.0, "precision": 0.5, "mrr": 0.5}
