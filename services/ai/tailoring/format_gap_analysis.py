"""Render a completed gap analysis as guidance for resume writers.

The saved analysis is produced by our gap-analysis worker, not edited by the user.
Current job and library sources remain the evidence for resume claims.
"""

from schemas.gap_analysis import GapAnalysisResult


def format_gap_analysis(value: dict[str, object] | None) -> str:
    """Include the overview and every assessment without putting JSON in the prompt."""
    if not value:
        return ""
    analysis = GapAnalysisResult.model_validate({"assessments": [], **value})
    lines = ["## Completed gap analysis", analysis.summary]
    for number, item in enumerate(analysis.assessments, start=1):
        kind = "Required" if item.kind == "required" else "Nice to have"
        lines.extend([
            "",
            f"{number}. {kind}: {item.requirement}",
            f"   Assessment: {item.verdict}. {item.explanation}",
        ])
        for evidence in item.evidence:
            context = f" ({evidence.context})" if evidence.context else ""
            lines.append(f"   Evidence ({evidence.kind}){context}: {evidence.text}")
    lines.extend(["", "Use this comparison as guidance. Confirm every resume claim against the current sources below."])
    return "\n".join(lines)
