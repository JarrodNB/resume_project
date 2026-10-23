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


def test_promotions_require_distinct_roles_and_their_own_bullets():
    """One retained promotion cannot stand in for two roles at the same employer."""
    from evals.resume_parsing_evaluators import ExperienceMatch

    junior = ParsedExperience(company="Acme", title="Engineer", start_date="2020",
                              end_date="2022", highlights=["Built the billing API."])
    senior = ParsedExperience(company="Acme", title="Senior Engineer", start_date="2022",
                              is_current=True, highlights=["Led the platform team."])
    expected = ParsedResume(experiences=[junior, senior])
    context = SimpleNamespace(expected_output=expected, metadata={},
                              output=ParsedResume(experiences=[senior]))
    scores = ExperienceMatch().evaluate(context)
    assert scores["experience_recall"] == 0.5
    assert scores["experience_highlight_recall"] == 0.5


def test_bullets_under_the_wrong_role_do_not_count_as_recalled():
    """Globally faithful bullets still need to belong to the labelled role."""
    from evals.resume_parsing_evaluators import ExperienceMatch

    roles = [ParsedExperience(company="Acme", title="Engineer", start_date="2020",
                              highlights=["Built billing."]),
             ParsedExperience(company="Acme", title="Lead", start_date="2022",
                              highlights=["Led migration."])]
    swapped = [role.model_copy(update={"roles": [role.roles[0].model_copy(update={"highlights": roles[1-index].roles[0].highlights})]})
               for index, role in enumerate(roles)]
    context = SimpleNamespace(expected_output=ParsedResume(experiences=roles), metadata={},
                              output=ParsedResume(experiences=swapped))
    scores = ExperienceMatch().evaluate(context)
    assert scores["experience_recall"] == 1.0
    assert scores["experience_highlight_recall"] == 0.0


def test_exact_period_is_reserved_before_matching_a_wrong_period():
    """An earlier missing stint cannot consume a later exact match with the same title."""
    from evals.resume_parsing_evaluators import ExperienceMatch

    old = ParsedExperience(company="Acme", title="Engineer", start_date="2010",
                           end_date="2012", highlights=["Built old system."])
    recent = old.model_copy(update={"roles": [old.roles[0].model_copy(update={"start_date": "2020", "end_date": "2022",
                                   "highlights": ["Built new system."]})]})
    context = SimpleNamespace(expected_output=ParsedResume(experiences=[old, recent]), metadata={},
                              output=ParsedResume(experiences=[recent]))
    scores = ExperienceMatch().evaluate(context)
    assert scores["experience_dates"] == 1.0
    assert scores["experience_highlight_recall"] == 0.5
