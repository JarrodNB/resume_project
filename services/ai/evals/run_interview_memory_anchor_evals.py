"""Validate synthetic anchor fixtures offline; --live calls the production agent once per case."""
import argparse
from pathlib import Path

import yaml
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator

from schemas.interview_memory_anchor import InterviewMemoryAnchor


class AnchorContract(Evaluator):
    def evaluate(self, ctx):
        return {
            "coverage": " ".join(" ".join(cue.sentence for cue in ctx.output.cues).split()) == " ".join(ctx.inputs.split()),
            "sentence_count": len(ctx.output.cues) == len(ctx.expected_output.cues),
            "bounded": 0 < len(ctx.output.text) <= 600,
            "key_details": all(term.lower() in ctx.output.text.lower() for term in ctx.metadata),
        }


def load_anchor_dataset():
    rows = yaml.safe_load((Path(__file__).parent / "datasets/interview_memory_anchor_cases.yaml").read_text())
    return Dataset(name="interview-memory-anchor", cases=[Case(name=row["name"], inputs=row["answer"],
        expected_output=InterviewMemoryAnchor.model_validate(row["expected"]), metadata=row["terms"]) for row in rows], evaluators=[AnchorContract()])


def generate(answer):
    from agents.interview_memory_anchor_agent import generate_interview_memory_anchor
    from model_inputs.interview_memory_anchor import format_memory_anchor_prompt
    from screening.session import (
        bind_screened_prompt,
        trust_generated_source,
        within_screening_session,
    )
    from settings import AISettings

    @within_screening_session
    def run():
        # Evaluation fixtures are synthetic trusted inputs, not saved user content.
        trust_generated_source(answer)
        text = bind_screened_prompt([answer], lambda values: format_memory_anchor_prompt(values[0]))
        return generate_interview_memory_anchor(text, answer, AISettings())
    return run()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Run paid generation on these three synthetic cases")
    args = parser.parse_args()
    dataset = load_anchor_dataset()
    if args.live:
        dataset.evaluate_sync(generate, max_concurrency=1).print()
    else:
        print("Offline fixture/evaluator checks only; model quality is unmeasured.")
        expected = {case.inputs: case.expected_output for case in dataset.cases}
        dataset.evaluate_sync(lambda answer: expected[answer], max_concurrency=1).print()
