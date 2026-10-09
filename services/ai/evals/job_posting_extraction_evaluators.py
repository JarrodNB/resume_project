"""
Description: Deterministic Pydantic Evals evaluators for job posting extraction (heading split
plus the requirements sorting agent fallback). Every score is between 0 and 1.
Index:
    - RequirementMatch: requirement and nice-to-have precision and recall against the labels
    - VerbatimBullets: every extracted bullet appears word for word in the posting
    - SortedByExpectedPath: headings vs LLM vs none matches the label (the LLM never runs when
      headings matched)
    - PostingFieldsMatch: title, company, and location copied from the page
    - JOB_POSTING_EXTRACTION_EVALUATORS: all evaluator classes, for Dataset.from_file
"""

from dataclasses import dataclass
from typing import Any

from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from documents.text_matching import appears_in, fraction, normalize_text
from job_postings.html_to_description_text import html_to_description_text
from schemas.scraped_job_posting import ScrapedJobPosting

JobInput = dict[str, Any]
JobPostingContext = EvaluatorContext[JobInput, ScrapedJobPosting, dict[str, Any]]


@dataclass
class RequirementMatch(Evaluator[JobInput, ScrapedJobPosting, dict[str, Any]]):
    """Compares the extracted lists to the labelled ones (normalised exact match)."""

    def evaluate(self, ctx: JobPostingContext) -> dict[str, float]:
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
class VerbatimBullets(Evaluator[JobInput, ScrapedJobPosting, dict[str, Any]]):
    """Nothing may be reworded: each bullet must appear in the posting's text."""

    def evaluate(self, ctx: JobPostingContext) -> dict[str, float]:
        """Scores the share of extracted bullets found in the description."""
        source_text = html_to_description_text(ctx.inputs.get("description_html") or "")
        bullets = ctx.output.requirements + ctx.output.responsibilities + ctx.output.nice_to_haves
        found = sum(appears_in(bullet, source_text) for bullet in bullets)
        return {"verbatim_bullets": fraction(found, len(bullets))}


@dataclass
class SortedByExpectedPath(Evaluator[JobInput, ScrapedJobPosting, dict[str, Any]]):
    """The heading split handles labelled postings; the LLM only runs for the others."""

    def evaluate(self, ctx: JobPostingContext) -> dict[str, float]:
        """Scores 1 when requirements_sorted_by matches the label."""
        if ctx.expected_output is None:
            return {}
        expected_path = ctx.expected_output.requirements_sorted_by
        return {"expected_path": float(ctx.output.requirements_sorted_by == expected_path)}


@dataclass
class PostingFieldsMatch(Evaluator[JobInput, ScrapedJobPosting, dict[str, Any]]):
    """Title, company, and location come straight from the page."""

    def evaluate(self, ctx: JobPostingContext) -> dict[str, float]:
        """Scores the share of the three fields that match the label."""
        if ctx.expected_output is None:
            return {}
        fields = ("title", "company", "location")
        matches = sum(
            getattr(ctx.output, name) == getattr(ctx.expected_output, name) for name in fields
        )
        return {"posting_fields": matches / len(fields)}


JOB_POSTING_EXTRACTION_EVALUATORS = [
    RequirementMatch,
    VerbatimBullets,
    SortedByExpectedPath,
    PostingFieldsMatch,
]


def _recall(wanted: list[str], found: list[str]) -> float:
    """Share of wanted bullets present (normalised) in found."""
    normalized_found = {normalize_text(text) for text in found}
    return fraction(sum(normalize_text(text) in normalized_found for text in wanted), len(wanted))
