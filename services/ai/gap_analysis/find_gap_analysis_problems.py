"""
Description: Checks the agent's GapAnalysis against the prompt's labels. The agent's output
validator sends any problems back to the model as a retry, so a saved analysis always covers
every requirement once and cites only entries that exist.
Index:
    - find_gap_analysis_problems: lists what's wrong (empty when the analysis is valid)
    - find_labels_in_text: prompt labels that leaked into user-facing prose
"""

import re
from collections import Counter

from gap_analysis.build_gap_analysis_prompt import GapAnalysisPrompt
from schemas.gap_analysis import GapAnalysis

LABEL_LIKE_WORD = re.compile(r"\b(?:SUMMARY|[A-Z]{1,2}\d+)\b")
BRACKETED_LABEL = re.compile(r"\[(?:SUMMARY|[A-Z]{1,2}\d+)\]")


def find_gap_analysis_problems(analysis: GapAnalysis, prompt: GapAnalysisPrompt) -> list[str]:
    """Missing, repeated, or unknown requirement labels; unknown evidence labels; and met or
    partial verdicts without evidence."""
    problems: list[str] = []
    counts = Counter(assessment.requirement_ref for assessment in analysis.assessments)

    missing = [ref for ref in prompt.requirements if ref not in counts]
    if missing:
        problems.append(f"Assess every requirement; missing: {', '.join(missing)}.")
    repeated = [ref for ref, count in counts.items() if count > 1]
    if repeated:
        problems.append(f"Assess each requirement once; repeated: {', '.join(repeated)}.")
    unknown = [ref for ref in counts if ref not in prompt.requirements]
    if unknown:
        problems.append(f"These requirement labels don't exist: {', '.join(unknown)}.")

    for assessment in analysis.assessments:
        ref = assessment.requirement_ref
        unknown_evidence = [
            label for label in assessment.evidence_refs if label not in prompt.evidence
        ]
        if unknown_evidence:
            problems.append(
                f"{ref} cites labels that aren't in the career library: {', '.join(unknown_evidence)}."
            )
        if assessment.verdict != "missing" and not assessment.evidence_refs:
            problems.append(
                f"{ref} is {assessment.verdict} but cites no evidence; cite the supporting "
                "entries or mark it missing."
            )
        leaked = find_labels_in_text(assessment.explanation, prompt)
        if leaked:
            problems.append(
                f"{ref}'s explanation mentions labels the user can't see ({', '.join(leaked)}); "
                "name the entries in words instead."
            )

    leaked_in_summary = find_labels_in_text(analysis.summary, prompt)
    if leaked_in_summary:
        problems.append(
            f"The summary mentions labels the user can't see ({', '.join(leaked_in_summary)}); "
            "name the entries in words instead."
        )
    return problems


def find_labels_in_text(text: str, prompt: GapAnalysisPrompt) -> list[str]:
    """Prompt labels (R1, H3, S2, SUMMARY, ...) written as whole words in user-facing text.
    Labels that are also real words in the job or library (e.g. "S3" for Amazon S3) are allowed."""
    words = set(LABEL_LIKE_WORD.findall(text))
    words_in_source = set(LABEL_LIKE_WORD.findall(BRACKETED_LABEL.sub("", prompt.text)))
    known_labels = [*prompt.requirements, *prompt.evidence]
    return [label for label in known_labels if label in words and label not in words_in_source]
