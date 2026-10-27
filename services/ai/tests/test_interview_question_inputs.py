"""Check that interview question inputs carry exactly the evidence shown to the model.

Exercise the pure context and its screening-aware preparation without provider calls.
"""

import pytest

from model_inputs.interview import build_interview_question_context
from schemas.gap_analysis_context import CareerLibrary, LibraryExperience, LibraryFact, LibrarySkill
from screening.interview_question_inputs import prepare_interview_question_context
from screening.library_inputs import screen_library_inputs
from screening.screen_user_text import ScreenOutcome
from screening.session import prompt_is_covered, screening_session, trust_generated_source


@pytest.mark.parametrize("set_type", ["general", "technical", "knowledge"])
def test_question_context_keeps_visible_evidence_and_citations_together(set_type):
    library = CareerLibrary(
        summary="Built careful reports.",
        experiences=[LibraryExperience(
            id="private-role", title="Analyst", company="Example", start_date="2022-01-01",
        )],
        skills=[LibrarySkill(id="private-skill", name="Python", category="Analysis")],
        facts=[LibraryFact(id="private-fact", requirement="Leadership", response="Led a study group.")],
    )
    context = build_interview_question_context(
        library, ["Old question?"], 1, set_type, recent_questions=["Recent question?"],
    )

    assert context.count == 1 and context.set_type == set_type
    assert context.excluded == ("Old question?",)
    assert context.evidence_by_id == {
        "E1": "Built careful reports.", "E2": "Analyst", "E3": "Example",
        "E4": "Python", "E5": "Analysis", "E6": "Led a study group.",
    }
    assert context.library_text == "Built careful reports.\nAnalyst\nExample\nPython\nAnalysis\nLed a study group."
    for key, source in context.evidence_by_id.items():
        assert f"[{key}]" in context.text and source in context.text
    assert "Dates: Jan 2022 – present" in context.text
    assert "Requirement context (not personal evidence): Leadership" in context.text
    assert "Recent practice questions (variety guidance, not exclusions or career evidence):" in context.text
    for context_only in ("Jan 2022", "Leadership", "Old question?", "Recent question?", "private-role"):
        assert context_only not in context.library_text


@pytest.mark.parametrize("trust_history", [False, True])
def test_preparation_requires_approval_for_every_prompt_source(trust_history):
    """Preparing context cannot itself turn unapproved generated history into coverage."""
    with screening_session():
        selected = screen_library_inputs(
            CareerLibrary(summary="Checked career detail."), lambda _: ScreenOutcome(allowed=True),
        )
        excluded = "Question to avoid?"
        recent = "Earlier question?"
        if trust_history:
            trust_generated_source(excluded)
            trust_generated_source(recent)
        context = prepare_interview_question_context(
            selected, [excluded], 5, "general", recent_questions=[recent],
        )

        assert prompt_is_covered(context.text) is trust_history
        assert context.library_text == "Checked career detail."
        assert context.evidence_by_id == {"E1": "Checked career detail."}
        assert context.excluded == (excluded,)
        assert excluded in context.text and recent in context.text
    with screening_session():
        assert not prompt_is_covered(context.text)


def test_preparation_omits_rejected_sources_from_both_prompt_and_citations():
    with screening_session():
        selected = screen_library_inputs(
            CareerLibrary(summary="Kept evidence", facts=[
                LibraryFact(id="rejected", requirement="Secret context", response="Rejected evidence"),
            ]),
            lambda text: ScreenOutcome(allowed="Rejected evidence" not in text),
        )
        context = prepare_interview_question_context(selected, [], 5, "general")

        assert selected.warnings
        assert prompt_is_covered(context.text)
        assert context.library_text == "Kept evidence"
        assert context.evidence_by_id == {"E1": "Kept evidence"}
        assert "Rejected evidence" not in context.text
        assert "Secret context" not in context.text
