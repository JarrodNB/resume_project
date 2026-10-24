"""
Description: The user-text screen eval labels score 1.0 against their own cases, with no
Jev call, and a low-confidence yes does not count as a block.
Index:
    - test_hand_labels_get_perfect_scores
    - test_unsure_yes_misses_a_labelled_block
"""

from types import SimpleNamespace

from evals.run_user_text_screen_evals import load_user_text_screen_dataset
from evals.user_text_screen_evaluators import DecisionMatch, labels_to_output
from schemas.user_text_screen import UserTextScreen


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case a sure answer that matches its labels scores 1.0 everywhere."""
    dataset = load_user_text_screen_dataset()
    assert len(dataset.cases) >= 8

    def answer(case_input):
        """The hand-labelled screen for this case."""
        labels = next(case.metadata for case in dataset.cases if case.inputs == case_input)
        assert labels is not None
        return labels_to_output(labels)

    report = dataset.evaluate_sync(answer, progress=False)

    scores = report.averages().scores
    assert scores and all(value == 1.0 for value in scores.values()), scores


def test_unsure_yes_misses_a_labelled_block() -> None:
    """A yes that sits under the 0.7 bar does not count as the labelled block."""
    case = next(case for case in load_user_text_screen_dataset().cases if case.name == "dan_jailbreak")
    assert case.metadata is not None
    output = labels_to_output(case.metadata)
    output.screen = UserTextScreen(prompt_injection=True)
    output.confidence = {"prompt_injection": 0.0}
    context = SimpleNamespace(inputs=case.inputs, output=output, metadata=case.metadata)

    scores = DecisionMatch().evaluate(context)  # type: ignore[arg-type]

    assert scores["decision_match"] == 0.0
