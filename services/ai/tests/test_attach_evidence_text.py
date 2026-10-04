"""
Description: Tests for turning the agent's labels into the result sent to Rails.
Index:
    - test_*: one behavior per test
"""

from datetime import date

from gap_analysis.attach_evidence_text import attach_evidence_text
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from schemas.gap_analysis import GapAnalysis, RequirementAssessment
from tests.fakes import build_gap_analysis_context

PROMPT = build_gap_analysis_prompt(build_gap_analysis_context(), date(2026, 10, 4))


def test_copies_requirement_and_evidence_text_from_the_prompt() -> None:
    """Requirement text and evidence ids/text come from the library, in posting order."""
    analysis = GapAnalysis(
        summary="Strong Python.",
        assessments=[
            RequirementAssessment(
                requirement_ref="N1", verdict="missing", evidence_refs=[], explanation="None."
            ),
            RequirementAssessment(
                requirement_ref="R2",
                verdict="met",
                evidence_refs=["H2", "S2", "H2"],
                explanation="Tuned queries.",
            ),
            RequirementAssessment(
                requirement_ref="R1", verdict="met", evidence_refs=["E1"], explanation="Since 2018."
            ),
        ],
    )

    result = attach_evidence_text(analysis, PROMPT)

    assert result.summary == "Strong Python."
    assert [item.requirement for item in result.assessments] == [
        "5+ years of Python",
        "PostgreSQL",
        "Kubernetes",
    ]
    assert [item.kind for item in result.assessments] == ["required", "required", "nice_to_have"]
    postgres = result.assessments[1]
    assert [(evidence.id, evidence.text) for evidence in postgres.evidence] == [
        ("highlight-2", "Tuned Postgres queries"),
        ("skill-2", "PostgreSQL"),
    ]
    assert result.assessments[0].evidence[0].text == "Senior Engineer at Now Co"
    assert result.assessments[2].evidence == []
