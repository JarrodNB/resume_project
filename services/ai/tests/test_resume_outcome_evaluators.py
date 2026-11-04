"""Check the countable resume measures with no model calls."""

from evals.resume_outcome_evaluators import (
    HiddenFact,
    OutcomeCase,
    OutcomeLabels,
    SupportedRequirement,
    generic_resume_sections,
    measure_resume,
    render_resume,
    weak_phrases,
)
from evals.run_resume_outcome_evals import edit_target_label, load_dataset, sign_test


def build_case():
    return OutcomeCase.model_validate({"full_name": "Sam Doe", "job": {"title": "Engineer", "requirements": ["Rust"]},
        "library": {"summary": "Engineer.", "skills": [{"name": "Python"}], "experiences": [
            {"company": "Old", "title": "Dev", "start_date": "2015-01-01", "end_date": "2018-01-01",
             "highlights": ["Cut costs 20%"]},
            {"company": "New", "title": "Lead", "start_date": "2019-01-01", "highlights": ["Arrived early"]}]}})


def experience(*roles):
    return [{"section_type": "experience", "content": {"items": list(roles)}}]


def measure(sections, labels=None):
    case = build_case()
    return measure_resume(sections, truth="Cut costs 20%", library=case.library, job=case.job,
                          labels=labels or OutcomeLabels())


def test_generic_resume_shows_every_role_newest_first_unchanged():
    text = render_resume(generic_resume_sections(build_case()))
    assert text.index("Lead, New") < text.index("Dev, Old")
    assert "- Cut costs 20%" in text and "SKILLS\nPython" in text


def test_false_claims_match_whole_words_only():
    role = {"title": "Dev", "company": "Old", "start_date": "2015-01", "highlights": ["Arrived with Rust"]}
    labels = OutcomeLabels(traps=["ARR", "Rust"])
    assert measure(experience(role), labels)["false_claim_terms"] == ["Rust"]


def test_invented_numbers_ignore_facts_the_version_was_allowed_to_know():
    role = {"title": "Dev", "company": "Old", "start_date": "2015-01", "highlights": ["Cut costs 20% for 45 clients"]}
    assert measure(experience(role))["invented_numbers"] == ["45"]


def test_order_requirements_and_hidden_facts_are_measured():
    old = {"title": "Dev", "company": "Old", "start_date": "2015-01", "highlights": ["Led rollouts"]}
    new = {"title": "Lead", "company": "New", "start_date": "2019-01", "highlights": []}
    labels = OutcomeLabels(supported=[SupportedRequirement(requirement="x", any_of=["roll*"])],
                           hidden_facts=[HiddenFact(fact="y", markers=["absent"])])
    result = measure(experience(old, new), labels)
    assert result["chronological"] is False and result["roles_without_bullets"] == 1
    assert result["requirement_coverage"] == 1 and result["hidden_fact_recall"] == 0


def test_sign_test_ignores_ties():
    assert sign_test([1, 1, 1, 1, 0.5]) == (4, 0, 1, 0.125)


def test_every_case_loads_with_labels():
    cases = load_dataset().cases
    assert len(cases) >= 10
    assert all(case.metadata.traps and case.metadata.notes for case in cases)


def test_edit_label_matches_the_position_production_renders():
    role = build_case().library.experiences[0].model_copy(update={"description": "Scope"})
    assert edit_target_label(role, role.id) == "T1"
    assert edit_target_label(role, role.highlights[0].id) == "T2"


def test_weak_phrases_finds_hedging_and_leaves_plain_bullets_alone():
    assert weak_phrases("- Contributed to work during which falls declined 18%") == ["contributed to work"]
    assert weak_phrases("- Ran weekly audits; falls fell 18% that year") == []
