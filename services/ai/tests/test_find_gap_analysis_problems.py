"""
Description: Tests for the gap analysis output checks the agent retries on.
Index:
    - assessment / valid_analysis: builders
    - test_*: one behavior per test
"""

from datetime import date

from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from gap_analysis.find_gap_analysis_problems import find_gap_analysis_problems
from schemas.gap_analysis import GapAnalysis, RequirementAssessment
from tests.fakes import build_gap_analysis_context

PROMPT = build_gap_analysis_prompt(build_gap_analysis_context(), date(2026, 10, 4))


def assessment(
    ref: str, verdict: str = "met", evidence: list[str] | None = None
) -> RequirementAssessment:
    """One assessment; met verdicts cite H1 unless told otherwise."""
    if evidence is None:
        evidence = [] if verdict == "missing" else ["H1"]
    return RequirementAssessment(
        requirement_ref=ref, verdict=verdict, evidence_refs=evidence, explanation="Because."
    )


def valid_analysis(*assessments: RequirementAssessment) -> GapAnalysis:
    """An analysis with the given assessments."""
    return GapAnalysis(assessments=list(assessments), summary="Summary.")


def test_a_complete_analysis_has_no_problems() -> None:
    """Every requirement once, known labels, evidence where needed."""
    analysis = valid_analysis(
        assessment("R1"), assessment("R2", "partial", ["H2", "S2"]), assessment("N1", "missing")
    )

    assert find_gap_analysis_problems(analysis, PROMPT) == []


def test_reports_missing_repeated_and_unknown_requirements() -> None:
    """R2 skipped, R1 twice, and an invented R9 are all reported."""
    analysis = valid_analysis(
        assessment("R1"), assessment("R1"), assessment("N1", "missing"), assessment("R9")
    )

    problems = find_gap_analysis_problems(analysis, PROMPT)

    assert "Assess every requirement; missing: R2." in problems
    assert "Assess each requirement once; repeated: R1." in problems
    assert "These requirement labels don't exist: R9." in problems


def test_reports_evidence_labels_not_in_the_library() -> None:
    """Citing H7 (there are only two highlights) is a problem."""
    analysis = valid_analysis(
        assessment("R1", evidence=["H1", "H7"]), assessment("R2"), assessment("N1", "missing")
    )

    assert find_gap_analysis_problems(analysis, PROMPT) == [
        "R1 cites labels that aren't in the career library: H7."
    ]


def test_met_or_partial_needs_evidence() -> None:
    """A met or partial verdict with no cited entries is sent back."""
    analysis = valid_analysis(
        assessment("R1", evidence=[]), assessment("R2", "partial", []), assessment("N1", "missing")
    )

    problems = find_gap_analysis_problems(analysis, PROMPT)

    assert len(problems) == 2
    assert problems[0].startswith("R1 is met but cites no evidence")
    assert problems[1].startswith("R2 is partial but cites no evidence")


def test_labels_in_explanations_and_summary_are_sent_back() -> None:
    """The user never sees labels, so prose that mentions them is a problem."""
    leaky = assessment("R1").model_copy(update={"explanation": "Your highlight H1 and S1 show it."})
    analysis = GapAnalysis(
        assessments=[leaky, assessment("R2"), assessment("N1", "missing")],
        summary="You match R2 well.",
    )

    assert find_gap_analysis_problems(analysis, PROMPT) == [
        (
            "R1's explanation mentions labels the user can't see (H1, S1); "
            "name the entries in words instead."
        ),
        "The summary mentions labels the user can't see (R2); name the entries in words instead.",
    ]


def test_label_like_words_from_the_job_are_allowed() -> None:
    """ "P1" is also a real term in this job (P1 incidents), so it isn't treated as a label."""
    prompt = build_gap_analysis_prompt(
        build_gap_analysis_context(requirements=["5+ years of Python", "Leads P1 incidents"]),
        date(2026, 10, 4),
    )
    explained = assessment("R2", "missing").model_copy(
        update={"explanation": "Nothing mentions handling P1 incidents."}
    )
    analysis = valid_analysis(assessment("R1"), explained, assessment("N1", "missing"))

    assert find_gap_analysis_problems(analysis, prompt) == []
