"""Score ambiguous bullet preservation in addition to the shared parsing quality checks."""

from dataclasses import dataclass

from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from schemas.parsed_resume import ParsedResume


@dataclass
class UnassignedPlacement(Evaluator[str, ParsedResume, dict]):
    """Measure exact ambiguous text, its source context and reason without relying on IDs."""

    def evaluate(self, ctx: EvaluatorContext[str, ParsedResume, dict]) -> dict[str, float]:
        expected = ctx.expected_output.unassigned_highlights if ctx.expected_output else []
        actual = ctx.output.unassigned_highlights
        expected_values = [(item.text, item.source_context, item.reason) for item in expected]
        actual_values = [(item.text, item.source_context, item.reason) for item in actual]
        correct = sum(value in actual_values for value in expected_values)
        return {
            "unassigned_recall": correct / len(expected) if expected else float(not actual),
            "unassigned_precision": correct / len(actual) if actual else float(not expected),
        }
