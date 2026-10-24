"""Check measured whole-document contracts; subjective quality belongs to the judge."""

from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator

from schemas.gap_analysis_context import GapAnalysisContext


class ResumeDocumentEvalInput(BaseModel):
    context: GapAnalysisContext
    target_pages: int = 1
    contact: dict[str, str] = Field(default_factory=dict)


class ResumeDocumentEvalLabels(BaseModel):
    """Expected case outcomes stay outside model inputs."""

    expected_page_count: int | None = None
    expected_shorter_fallback: bool = False
    fallback_reason_terms: list[str] = Field(default_factory=list)


class ResumeDocumentEvalOutput(BaseModel):
    markdown: str
    page_count: int
    final_page_occupied_share: float
    editorial_review: dict
    warnings: list[str]
    drafts: int


@dataclass
class MeasuredResumeContract(
    Evaluator[ResumeDocumentEvalInput, ResumeDocumentEvalOutput, ResumeDocumentEvalLabels]
):
    """Score actual task metadata, without claiming these checks establish writing quality."""

    def evaluate(self, ctx):
        output = ctx.output
        scores = {
            "measured_page_target": float(0 < output.page_count <= ctx.inputs.target_pages),
            "bounded_drafts": float(1 <= output.drafts <= 3),
            "editorial_review_present": float(bool(output.editorial_review.get("feedback"))),
            "nonempty_document": float(bool(output.markdown.strip())),
            "shorter_explanation": float(
                ctx.inputs.target_pages == 1 or output.page_count == 2 or bool(output.warnings)
            ),
        }

        labels = ctx.metadata
        if labels and labels.expected_page_count is not None:
            scores["expected_page_count"] = float(output.page_count == labels.expected_page_count)
        if labels and labels.expected_shorter_fallback:
            explanation = str(output.editorial_review.get("sufficiency_explanation", ""))
            scores["specific_shorter_fallback"] = float(
                output.page_count < ctx.inputs.target_pages
                and output.editorial_review.get("sufficient_for_target") is False
                and bool(explanation.strip())
                and any(explanation in warning for warning in output.warnings)
                and (
                    not labels.fallback_reason_terms
                    or any(term in explanation.casefold() for term in labels.fallback_reason_terms)
                )
            )
        return scores
