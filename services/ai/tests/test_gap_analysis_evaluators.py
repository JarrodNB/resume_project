"""
Description: Sanity checks for the gap analysis eval dataset and evaluators (no LLM calls): hand
labels score 1.0, and the evaluators catch a missed gap and invented evidence.
Index:
    - test_hand_labels_get_perfect_scores: labels are consistent with their cases and evaluators
    - test_calling_a_gap_met_lowers_gap_recall
    - test_invented_evidence_fails_validity
"""

from types import SimpleNamespace

from evals.gap_analysis_evaluators import EvidenceValidity, GapRecall, labels_to_result
from evals.run_gap_analysis_evals import load_gap_analysis_dataset
from schemas.gap_analysis import EvidenceItem


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case the result its labels describe scores 1.0 everywhere."""
    dataset = load_gap_analysis_dataset()
    assert len(dataset.cases) >= 6
    labels = {case.inputs.job.id: case.metadata for case in dataset.cases}

    report = dataset.evaluate_sync(
        lambda context: labels_to_result(context, labels[context.job.id]), progress=False
    )

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores


def test_calling_a_gap_met_lowers_gap_recall() -> None:
    """In the obvious-gaps case, calling PyTorch met is caught."""
    case = next(case for case in load_gap_analysis_dataset().cases if case.name == "obvious_gaps")
    output = labels_to_result(case.inputs, case.metadata)
    output.assessments[1].verdict = "met"
    context = SimpleNamespace(inputs=case.inputs, output=output, metadata=case.metadata)

    scores = GapRecall().evaluate(context)  # type: ignore[arg-type]

    assert scores["gap_recall"] == 2 / 3


def test_invented_evidence_fails_validity() -> None:
    """Evidence text that differs from the library entry doesn't count."""
    case = next(case for case in load_gap_analysis_dataset().cases if case.name == "strong_match")
    output = labels_to_result(case.inputs, case.metadata)
    output.assessments[3].evidence = [
        EvidenceItem(kind="skill", id="sk-3", text="Kubernetes (CKA)")
    ]
    context = SimpleNamespace(inputs=case.inputs, output=output, metadata=case.metadata)

    scores = EvidenceValidity().evaluate(context)  # type: ignore[arg-type]

    assert scores["evidence_validity"] < 1.0
