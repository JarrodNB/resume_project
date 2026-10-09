"""
Description: Deterministic Pydantic Evals evaluators for parsing a pasted job ad. Every score
is between 0 and 1. They score the ScrapedJobPosting the handler would save, not the raw
agent output.
Index:
    - PastedFieldMatch: title, company, and location
    - PastedRequirementMatch: requirement and nice-to-have precision and recall
    - PastedVerbatim: every bullet appears in the pasted ad
    - JOB_POSTING_PARSE_EVALUATORS: all evaluator classes, for Dataset.from_file
"""

from dataclasses import dataclass
from typing import Any

from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from documents.text_matching import appears_in, fraction, normalize_text
from schemas.scraped_job_posting import ScrapedJobPosting

ParseInput = dict[str, Any]
ParseContext = EvaluatorContext[ParseInput, ScrapedJobPosting, dict[str, Any]]


@dataclass
class PastedFieldMatch(Evaluator[ParseInput, ScrapedJobPosting, dict[str, Any]]):
    """Title, company, and location match the labels."""

    def evaluate(self, ctx: ParseContext) -> dict[str, float]:
        """Scores the share of the three fields that match the label."""
        if ctx.expected_output is None:
            return {}
        fields = ("title", "company", "location")
        matches = sum(
            getattr(ctx.output, name) == getattr(ctx.expected_output, name) for name in fields
        )
        return {"posting_fields": matches / len(fields)}


@dataclass
class PastedRequirementMatch(Evaluator[ParseInput, ScrapedJobPosting, dict[str, Any]]):
    """Compares the extracted lists to the labelled ones (normalised exact match)."""

    def evaluate(self, ctx: ParseContext) -> dict[str, float]:
        """Scores precision and recall of both lists."""
        expected = ctx.expected_output
        if expected is None:
            return {}
        return {
            "requirement_recall": _recall(expected.requirements, ctx.output.requirements),
            "requirement_precision": _recall(ctx.output.requirements, expected.requirements),
            "responsibility_recall": _recall(expected.responsibilities, ctx.output.responsibilities),
            "responsibility_precision": _recall(ctx.output.responsibilities, expected.responsibilities),
            "nice_to_have_recall": _recall(expected.nice_to_haves, ctx.output.nice_to_haves),
            "nice_to_have_precision": _recall(ctx.output.nice_to_haves, expected.nice_to_haves),
        }


@dataclass
class PastedVerbatim(Evaluator[ParseInput, ScrapedJobPosting, dict[str, Any]]):
    """Nothing may be invented: each bullet must appear in the pasted ad."""

    def evaluate(self, ctx: ParseContext) -> dict[str, float]:
        """Scores the share of extracted bullets found in the ad."""
        source_text = ctx.inputs.get("text") or ""
        bullets = ctx.output.requirements + ctx.output.responsibilities + ctx.output.nice_to_haves
        found = sum(appears_in(bullet, source_text) for bullet in bullets)
        return {"verbatim_bullets": fraction(found, len(bullets))}


def _recall(expected: list[str], actual: list[str]) -> float:
    """Share of expected items present in actual, after normalisation."""
    wanted = {normalize_text(item) for item in expected}
    got = {normalize_text(item) for item in actual}
    if not wanted:
        return 1.0 if not got else 0.0
    return len(wanted & got) / len(wanted)


JOB_POSTING_PARSE_EVALUATORS = (PastedFieldMatch, PastedRequirementMatch, PastedVerbatim)
