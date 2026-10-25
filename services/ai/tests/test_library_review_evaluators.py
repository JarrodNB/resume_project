"""Keep question-quality calibration honest about missing and unnecessary questions."""

from types import SimpleNamespace

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
