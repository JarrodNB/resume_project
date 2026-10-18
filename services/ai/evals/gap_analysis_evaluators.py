"""
Description: Deterministic Pydantic Evals evaluators for the gap analysis agent. Cases carry hand
labels in their metadata (GapAnalysisLabels): each requirement's verdict, any other acceptable
verdicts for borderline cases, and the library ids of which at least one must be cited. Every
score is between 0 and 1.
Index:
    - ExpectedAssessment / GapAnalysisLabels: the hand labels of one case
    - Coverage: every requirement assessed exactly once, with the right kind
    - EvidenceValidity: every cited entry exists in the library with the same text
    - VerdictAccuracy: verdict matches the label; met vs not met agrees
    - GapRecall: requirements labelled missing aren't called met
    - EvidenceRecall: met or partial verdicts cite one of the labelled key entries
    - labels_to_result: the result a perfect agent would return (for the label sanity test)
    - GAP_ANALYSIS_EVALUATORS: all evaluator classes, for Dataset.from_file
"""

from dataclasses import dataclass
from datetime import date

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from documents.text_matching import fraction
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from schemas.gap_analysis import AssessedRequirement, GapAnalysisResult, Verdict
from schemas.gap_analysis_context import GapAnalysisContext


class ExpectedAssessment(BaseModel):
    """The hand label of one requirement."""

    requirement: str
    verdict: Verdict
    also_acceptable: list[Verdict] = Field(default_factory=list)
    key_evidence_ids: list[str] = Field(
        default_factory=list, description="Library ids; citing any one of them counts."
    )


class GapAnalysisLabels(BaseModel):
    """The hand labels of one case, one per requirement and nice-to-have."""

    assessments: list[ExpectedAssessment]


GapContext = EvaluatorContext[GapAnalysisContext, GapAnalysisResult, GapAnalysisLabels]
GapEvaluator = Evaluator[GapAnalysisContext, GapAnalysisResult, GapAnalysisLabels]


def _labelled_pairs(ctx: GapContext) -> list[tuple[ExpectedAssessment, AssessedRequirement]]:
    """Each label with the output's assessment of the same requirement (if there is one)."""
    by_requirement = {item.requirement: item for item in ctx.output.assessments}
    labels = ctx.metadata.assessments if ctx.metadata else []
    return [
        (label, by_requirement[label.requirement])
        for label in labels
        if label.requirement in by_requirement
    ]


@dataclass
class Coverage(GapEvaluator):
    """Requirements, then nice-to-haves, each exactly once."""

    def evaluate(self, ctx: GapContext) -> dict[str, float]:
        """Scores 1 when the output lists exactly the job's requirements, in order, by kind."""
        job = ctx.inputs.job
        expected = [("required", text) for text in job.requirements] + [
            ("nice_to_have", text) for text in job.nice_to_haves
        ]
        actual = [(item.kind, item.requirement) for item in ctx.output.assessments]
        return {"coverage": float(actual == expected)}


@dataclass
class EvidenceValidity(GapEvaluator):
    """No invented evidence: every cited entry is in the library, with its exact text."""

    def evaluate(self, ctx: GapContext) -> dict[str, float]:
        """Scores the share of cited entries that match a library entry."""
        library = build_gap_analysis_prompt(ctx.inputs, date.min).evidence.values()
        known = {(item.kind, item.id, item.text) for item in library}
        cited = [evidence for item in ctx.output.assessments for evidence in item.evidence]
        valid = sum((evidence.kind, evidence.id, evidence.text) in known for evidence in cited)
        return {"evidence_validity": fraction(valid, len(cited))}


@dataclass
class VerdictAccuracy(GapEvaluator):
    """The verdict matches the label (or an acceptable alternative)."""

    def evaluate(self, ctx: GapContext) -> dict[str, float]:
        """Scores exact (or acceptable) verdicts, and agreement on met vs not met."""
        pairs = _labelled_pairs(ctx)
        if not pairs:
            return {}
        accurate = sum(
            output.verdict in [label.verdict, *label.also_acceptable] for label, output in pairs
        )
        met_agrees = sum(
            (output.verdict == "met") == (label.verdict == "met") for label, output in pairs
        )
        return {
            "verdict_accuracy": fraction(accurate, len(pairs)),
            "met_agreement": fraction(met_agrees, len(pairs)),
        }


@dataclass
class GapRecall(GapEvaluator):
    """Known gaps are found: nothing labelled missing is called met."""

    def evaluate(self, ctx: GapContext) -> dict[str, float]:
        """Scores the share of labelled gaps the output doesn't call met."""
        gaps = [
            (label, output) for label, output in _labelled_pairs(ctx) if label.verdict == "missing"
        ]
        if not gaps:
            return {}
        found = sum(output.verdict != "met" for _label, output in gaps)
        return {"gap_recall": fraction(found, len(gaps))}


@dataclass
class EvidenceRecall(GapEvaluator):
    """Met and partial verdicts point at the entries that actually show the requirement."""

    def evaluate(self, ctx: GapContext) -> dict[str, float]:
        """Scores the share of labelled key evidence lists the output cites from."""
        pairs = [
            (label, output)
            for label, output in _labelled_pairs(ctx)
            if label.key_evidence_ids and output.verdict != "missing"
        ]
        if not pairs:
            return {}
        cited = sum(
            any(evidence.id in label.key_evidence_ids for evidence in output.evidence)
            for label, output in pairs
        )
        return {"evidence_recall": fraction(cited, len(pairs))}


def labels_to_result(context: GapAnalysisContext, labels: GapAnalysisLabels) -> GapAnalysisResult:
    """The result an agent that agrees with every label would produce."""
    evidence_by_id = {
        item.id: item for item in build_gap_analysis_prompt(context, date.min).evidence.values()
    }
    kinds = {text: "required" for text in context.job.requirements} | {
        text: "nice_to_have" for text in context.job.nice_to_haves
    }
    return GapAnalysisResult(
        summary="Labels.",
        assessments=[
            AssessedRequirement(
                kind=kinds[label.requirement],
                requirement=label.requirement,
                verdict=label.verdict,
                explanation="Label.",
                evidence=[evidence_by_id[evidence_id] for evidence_id in label.key_evidence_ids],
            )
            for label in labels.assessments
        ],
    )


GAP_ANALYSIS_EVALUATORS = [Coverage, EvidenceValidity, VerdictAccuracy, GapRecall, EvidenceRecall]
