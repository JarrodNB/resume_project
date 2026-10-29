"""Compare synthetic preference outcomes and exact evidence without a subjective judge."""
from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator


class PreferenceEvalInput(BaseModel):
    criterion: str
    passages: list[str] = Field(min_length=1)


class PreferenceEvalLabels(BaseModel):
    status: str
    support: str | None = None
    contradiction: str | None = None
    blocked: bool = False


class PreferenceEvalOutput(BaseModel):
    status: str
    decision: dict | None = None
    failure_code: str | None = None


@dataclass
class PreferenceOutcome(Evaluator[PreferenceEvalInput, PreferenceEvalOutput, PreferenceEvalLabels]):
    """Keep provider outages separate from block decisions and factual matching accuracy."""
    def evaluate(self, ctx):
        expected, output = ctx.metadata, ctx.output
        if expected.blocked:
            return {"decision_match": float(output.status == "failed" and output.failure_code == "input_rejected"),
                "evidence_valid": float(output.decision is None)}
        decision = output.decision
        if output.status != "completed" or not decision:
            return {"decision_match": 0.0, "evidence_valid": 0.0}
        status_matches = decision.get("status") == expected.status
        evidence_valid = True
        for side in ("support", "contradiction"):
            evidence = decision.get(side)
            required = getattr(expected, side)
            if evidence is None:
                evidence_valid &= required is None
            elif not isinstance(evidence, dict):
                evidence_valid = False
            else:
                evidence_valid &= evidence.get("passage_id") == required
                try:
                    index = int(evidence["passage_id"][1:]) - 1
                    evidence_valid &= 0 <= index < len(ctx.inputs.passages) and evidence.get("text") == ctx.inputs.passages[index]
                except (KeyError, TypeError, ValueError):
                    evidence_valid = False
        return {"decision_match": float(status_matches), "evidence_valid": float(evidence_valid)}
