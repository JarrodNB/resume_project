"""Check question calibration and distinguish execution errors from low quality scores."""

from types import SimpleNamespace

import pytest

from evals import run_library_review_evals as review_evals
from evals.run_library_review_evals import ReviewCalibration, load_library_review_dataset


def test_question_calibration_rejects_missing_and_unnecessary_questions():
    evaluator = ReviewCalibration()
    for expected, question in [(True, None), (False, "How much did it improve?")]:
        context = SimpleNamespace(
            metadata={"colors": [["yellow"]], "questions": [expected]},
            output={"assessments": [{"color": "yellow", "question": question}]},
        )
        assert evaluator.evaluate(context)["question_calibration"] == 0


def test_synthetic_review_labels_cover_every_expected_question():
    dataset = load_library_review_dataset()
    assert len(dataset.cases) == 8
    for case in dataset.cases:
        metadata = case.metadata
        output = {"assessments": [
            {"color": colors[0], "question": "What did you do?" if question else None}
            for colors, question in zip(metadata["colors"], metadata["questions"], strict=True)
        ]}
        assert all(ReviewCalibration().evaluate(SimpleNamespace(metadata=metadata, output=output)).values())


@pytest.mark.parametrize("report", [
    SimpleNamespace(failures=["generation failed"], cases=[]),
    SimpleNamespace(failures=[], cases=[SimpleNamespace(evaluator_failures=["judge failed"])]),
])
def test_review_runner_rejects_execution_and_evaluator_errors(monkeypatch, report):
    monkeypatch.setattr(review_evals, "evaluate_dataset", lambda *_args, **_kwargs: report)

    with pytest.raises(RuntimeError, match="execution or evaluator errors"):
        review_evals.run_library_review_evals()


def test_review_runner_returns_completed_reports_without_gating_quality_scores(monkeypatch):
    report = SimpleNamespace(failures=[], cases=[SimpleNamespace(evaluator_failures=[], scores={"quality": 0})])
    monkeypatch.setattr(review_evals, "evaluate_dataset", lambda *_args, **_kwargs: report)

    assert review_evals.run_library_review_evals() is report
