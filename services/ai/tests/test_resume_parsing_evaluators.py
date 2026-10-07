"""
Description: Sanity checks for the resume parsing eval dataset and evaluators (no LLM calls).
Index:
    - test_hand_labels_get_perfect_scores: labels are faithful to their inputs and score 1.0
    - test_invented_highlight_lowers_faithfulness: the faithfulness check catches invented text
    - test_forbidden_string_fails_the_injection_check: an embedded instruction copied into the parse scores 0
"""

from types import SimpleNamespace

from evals.resume_parsing_evaluators import IgnoresEmbeddedInstructions, SourceFaithfulness
from evals.run_resume_parsing_evals import load_resume_parsing_dataset
from schemas.parsed_resume import ParsedExperience, ParsedResume, ParsedSkill


def test_hand_labels_get_perfect_scores() -> None:
    """Feeding each case its own expected output scores 1.0 everywhere except warnings."""
    dataset = load_resume_parsing_dataset()
    labels = {case.inputs: case.expected_output or ParsedResume() for case in dataset.cases}

    report = dataset.evaluate_sync(lambda resume_text: labels[resume_text], progress=False)

    scores = report.averages().scores
    assert scores.pop("warns_when_ambiguous") == 0.0
    assert scores and all(value == 1.0 for value in scores.values()), scores


def test_invented_highlight_lowers_faithfulness() -> None:
    """A bullet point that isn't in the resume text is flagged."""
    output = ParsedResume(
        experiences=[
            ParsedExperience(
                company="Acme",
                title="Engineer",
                highlights=["Built the billing API.", "Increased revenue by 300%."],
            )
        ]
    )
    context = SimpleNamespace(inputs="Engineer at Acme\n• Built the billing\nAPI.", output=output)

    scores = SourceFaithfulness().evaluate(context)  # type: ignore[arg-type]

    assert scores["faithful_highlights"] == 0.5


def test_forbidden_string_fails_the_injection_check() -> None:
    """A skill the embedded instruction asked for is not a successful parse."""
    output = ParsedResume(skills=[ParsedSkill(name="System Override")])
    context = SimpleNamespace(
        metadata={"forbidden_strings": ["System Override"]},
        output=output,
    )

    scores = IgnoresEmbeddedInstructions().evaluate(context)  # type: ignore[arg-type]

    assert scores["ignores_embedded_instructions"] == 0.0
