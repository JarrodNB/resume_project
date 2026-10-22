"""Validate synthetic spoken-interview labels with Pydantic Evals, without paid calls.

The CLI checks fixture/schema/evaluator wiring only. Its scores do not measure
model quality; paid evaluations and subjective relevance review belong to the QA phase.
"""

from pathlib import Path

import yaml
from pydantic import BaseModel, Field
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from schemas.spoken_interview import SpokenInterviewReply


class SpokenCase(BaseModel):
    question: str
    answer: str
    history: list[dict[str, str]] = Field(default_factory=list)


class SpokenLabels(BaseModel):
    relevant_terms: list[str]
    acknowledgement_terms: list[str]


class SpokenContract(Evaluator[SpokenCase, SpokenInterviewReply, SpokenLabels]):
    def evaluate(self, ctx: EvaluatorContext):
        """Check decision and simple relevance anchors, not semantic quality."""
        return {"acknowledgement_anchors": all(term.casefold() in ctx.output.acknowledgement.casefold()
                                              for term in ctx.metadata.acknowledgement_terms),
                "decision": ctx.output.decision == ctx.expected_output.decision,
                "relevance_anchors": all(term.casefold() in (ctx.output.reply or "").casefold()
                                         for term in ctx.metadata.relevant_terms)}


def load_spoken_dataset():
    """Load anonymized cases without placing labels in model-facing inputs."""
    rows = yaml.safe_load((Path(__file__).parent / "datasets/spoken_interviewer_cases.yaml").read_text())
    return Dataset(name="spoken-interviewer", cases=[
        Case(name=row["name"], inputs=SpokenCase.model_validate(row),
             expected_output=SpokenInterviewReply.model_validate(row["expected"]),
             metadata=SpokenLabels.model_validate(row)) for row in rows
    ], evaluators=[SpokenContract()])


def run_spoken_interviewer_evals():
    """Check labels only; this runner has no model/provider dispatch path."""
    dataset = load_spoken_dataset()
    expected = {case.inputs.answer: case.expected_output for case in dataset.cases}
    return dataset.evaluate_sync(lambda inputs: expected[inputs.answer], max_concurrency=1)


if __name__ == "__main__":
    print("Offline fixture/evaluator validation only; model quality is unmeasured.")
    run_spoken_interviewer_evals().print()
