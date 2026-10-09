"""
Description: The gap analysis agent's output and the result sent to Rails. The agent cites
evidence by short reference labels only ("H3", "S1"); the worker swaps those for the library
text (gap_analysis/attach_evidence_text.py), so no quoted evidence can be invented.
Index:
    - Verdict / RequirementKind / EvidenceKind: allowed values
    - RequirementAssessment / GapAnalysis: the agent's output_type
    - EvidenceItem / AssessedRequirement / GapAnalysisResult: the completed task's result
      (`{gap_analysis: GapAnalysisResult}`), read by the web app
"""

from typing import Literal

from pydantic import BaseModel, Field

Verdict = Literal["met", "partial", "missing"]
RequirementKind = Literal["required", "responsibility", "nice_to_have"]
EvidenceKind = Literal[
    "summary", "experience", "highlight", "project", "education", "skill", "fact"
]


class RequirementAssessment(BaseModel):
    """How well the career library covers one job requirement."""

    requirement_ref: str = Field(
        description='The requirement\'s label from the prompt, e.g. "R1", "D2", or "N1".'
    )
    verdict: Verdict = Field(
        description="met: the library clearly shows it. partial: related or weaker evidence "
        "(adjacent skill, fewer years, similar tool). missing: nothing in the library supports it."
    )
    evidence_refs: list[str] = Field(
        default_factory=list,
        description='Labels of the library entries that support the verdict, e.g. ["H3", "S1"]. '
        "Required for met and partial; usually empty for missing.",
    )
    explanation: str = Field(
        description="One or two sentences on why, naming what is there and what is lacking."
    )


class GapAnalysis(BaseModel):
    """Every requirement, responsibility, and nice-to-have, each assessed once."""

    assessments: list[RequirementAssessment]
    summary: str = Field(
        description="Two or three sentences: the strongest matches and the most important gaps."
    )


class EvidenceItem(BaseModel):
    """One career library entry cited as evidence, with its text copied from the library."""

    kind: EvidenceKind
    id: str | None = Field(default=None, description="Database id (None for the summary).")
    text: str
    context: str | None = Field(
        default=None, description='Where it sits, e.g. "Lead at Now Co" for a highlight.'
    )


class AssessedRequirement(BaseModel):
    """One requirement with its verdict, explanation, and evidence."""

    kind: RequirementKind
    requirement: str
    verdict: Verdict
    explanation: str
    evidence: list[EvidenceItem] = Field(default_factory=list)


class GapAnalysisResult(BaseModel):
    """The completed gap analysis: requirements, then responsibilities, then nice-to-haves."""

    summary: str
    assessments: list[AssessedRequirement]
