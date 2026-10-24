"""Check measured whole-document contracts; subjective quality belongs to the judge."""

from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator

from schemas.gap_analysis_context import GapAnalysisContext


class ResumeDocumentEvalInput(BaseModel):
    context: GapAnalysisContext
    target_pages: int = 1
    contact: dict[str, str] = Field(default_factory=dict)


class ResumeDocumentEvalOutput(BaseModel):
    markdown: str
    page_count: int
    final_page_occupied_share: float
    editorial_review: dict
    warnings: list[str]
    drafts: int


@dataclass
class MeasuredResumeContract(Evaluator[ResumeDocumentEvalInput, ResumeDocumentEvalOutput]):
    """Score actual task metadata, without claiming these checks establish writing quality."""

    def evaluate(self, ctx):
        output = ctx.output
        return {
            "measured_page_target": float(0 < output.page_count <= ctx.inputs.target_pages),
            "bounded_drafts": float(1 <= output.drafts <= 3),
            "editorial_review_present": float(bool(output.editorial_review.get("feedback"))),
            "nonempty_document": float(bool(output.markdown.strip())),
            "shorter_explanation": float(
                ctx.inputs.target_pages == 1 or output.page_count == 2 or bool(output.warnings)
            ),
        }
