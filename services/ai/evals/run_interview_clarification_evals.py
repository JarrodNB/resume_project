"""Check synthetic clarification labels and evaluator wiring without provider calls.

This does not measure model quality or prove the no-coaching policy semantically.
"""
from pathlib import Path

import yaml
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator

from schemas.interview_clarification import InterviewClarification


class ClarificationContract(Evaluator):
    def evaluate(self, ctx):
        return {"short": len(ctx.output.explanation) <= 1000,
                "question_terms": all(term in ctx.output.explanation for term in ctx.metadata)}


def load_clarification_dataset():
    rows = yaml.safe_load((Path(__file__).parent / "datasets/interview_clarification_cases.yaml").read_text())
    return Dataset(name="interview-clarification", cases=[Case(name=row["name"], inputs=row["question"],
        expected_output=InterviewClarification.model_validate(row["expected"]), metadata=row["terms"]) for row in rows],
        evaluators=[ClarificationContract()])


if __name__ == "__main__":
    print("Offline fixture/evaluator validation only; model quality is unmeasured.")
    dataset = load_clarification_dataset()
    expected = {case.inputs: case.expected_output for case in dataset.cases}
    dataset.evaluate_sync(lambda question: expected[question], max_concurrency=1).print()
