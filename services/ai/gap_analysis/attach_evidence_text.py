"""
Description: Turns the agent's GapAnalysis (labels only) into the GapAnalysisResult sent to
Rails: each requirement's text and each cited entry's id and text come from the prompt's label
maps, never from the model. Assessments follow the posting's order, whatever order the model used.
Index:
    - attach_evidence_text: builds the GapAnalysisResult
"""

from gap_analysis.build_gap_analysis_prompt import GapAnalysisPrompt
from schemas.gap_analysis import AssessedRequirement, GapAnalysis, GapAnalysisResult


def attach_evidence_text(analysis: GapAnalysis, prompt: GapAnalysisPrompt) -> GapAnalysisResult:
    """Swaps labels for library text. Expects a validated analysis (every label known, every
    requirement assessed once); unknown evidence labels are skipped and repeats dropped."""
    by_requirement = {assessment.requirement_ref: assessment for assessment in analysis.assessments}
    assessed: list[AssessedRequirement] = []
    for ref, requirement in prompt.requirements.items():
        assessment = by_requirement[ref]
        evidence_refs = list(dict.fromkeys(assessment.evidence_refs))
        assessed.append(
            AssessedRequirement(
                kind=requirement.kind,
                requirement=requirement.text,
                verdict=assessment.verdict,
                explanation=assessment.explanation,
                evidence=[prompt.evidence[ref] for ref in evidence_refs if ref in prompt.evidence],
            )
        )
    return GapAnalysisResult(summary=analysis.summary, assessments=assessed)
