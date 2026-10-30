"""Check synthetic probability bands without claiming statistical calibration."""
from dataclasses import dataclass
from math import isfinite

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator


class PreferenceEvalInput(BaseModel):
    criterion: str
    passages: list[str] = Field(min_length=1)


class PreferenceEvalLabels(BaseModel):
    minimum: float = Field(ge=0, le=1)
    maximum: float = Field(ge=0, le=1)


class PreferenceEvalOutput(BaseModel):
    status: str
    probability: float | None = None


@dataclass
class PreferenceOutcome(Evaluator[PreferenceEvalInput, PreferenceEvalOutput, PreferenceEvalLabels]):
    """Broad fixture expectations measure directional behavior, not calibrated likelihoods."""
    def evaluate(self, ctx):
        probability = ctx.output.probability
        valid = ctx.output.status == "completed" and isinstance(probability, float) and isfinite(probability) and 0 <= probability <= 1
        return {"probability_valid": float(valid),
            "expected_band": float(valid and ctx.metadata.minimum <= probability <= ctx.metadata.maximum)}
