"""Synthetic guide outcomes and deterministic checks for safe source handling."""
from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from schemas.study_guide import StudyGuide


class StudyGuideEvalInput(BaseModel):
    description: str
    previous_questions: list[str] = Field(default_factory=list)
    expects_unusable: bool = False


class StudyGuideEvalOutput(BaseModel):
    status: str
    guide: StudyGuide | None = None
    failure_code: str | None = None


@dataclass
class StudyGuideOutcome(Evaluator[StudyGuideEvalInput, StudyGuideEvalOutput, None]):
    """Distinguish usable learning content from an insufficient description."""
    def evaluate(self, ctx: EvaluatorContext[StudyGuideEvalInput, StudyGuideEvalOutput, None]):
        if ctx.inputs.expects_unusable:
            return {"expected_outcome": float(ctx.output.status == "failed" and ctx.output.guide is None and ctx.output.failure_code == "insufficient_description")}
        return {"expected_outcome": float(ctx.output.status == "completed" and ctx.output.guide is not None)}
