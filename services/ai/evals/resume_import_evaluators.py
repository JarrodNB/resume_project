"""Score ambiguous bullet preservation in addition to the shared parsing quality checks."""

from dataclasses import dataclass

from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from documents.text_matching import normalize_text
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


@dataclass
class ContactAttribution(Evaluator[str, ParsedResume, dict]):
    """Catch invented candidate identities or project links misplaced as contact links."""

    def evaluate(self, ctx: EvaluatorContext[str, ParsedResume, dict]) -> dict[str, float]:
        expected = ctx.expected_output.contact if ctx.expected_output else ParsedResume().contact
        actual = ctx.output.contact
        expected_links = {link.url for link in expected.links}
        actual_links = {link.url for link in actual.links}
        matches = len(expected_links & actual_links)
        return {
            "candidate_name_match": float(
                normalize_text(actual.full_name or "") == normalize_text(expected.full_name or "")
            ),
            "contact_link_precision": matches / len(actual_links) if actual_links else 1.0,
            "contact_link_recall": matches / len(expected_links) if expected_links else 1.0,
        }
