"""Deterministic scores for personalized job ordering against labeled examples.

Labels describe which roles are relevant to a synthetic career profile. They
are evaluation metadata and are never sent to the embedding provider.
"""

from dataclasses import dataclass

from pydantic import BaseModel
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from evals.job_relevance_ranker import compare_rankings


class CareerLibraryEntry(BaseModel):
    """One synthetic career fact shaped like text stored for library search."""

    id: str
    content: str


class JobListingText(BaseModel):
    """Listing text that is available to the shared Job Board search."""

    id: str
    content: str


class JobRelevanceInputs(BaseModel):
    """A synthetic career library and the synthetic-input-ordered candidate listings."""

    profile_id: str
    career_library: list[CareerLibraryEntry]
    listings: list[JobListingText]


class JobRelevanceLabels(BaseModel):
    """Hand labels for useful listings and plausible but misleading hard negatives."""

    relevant_listing_ids: list[str]
    hard_negative_listing_ids: list[str]


class RankedJobs(BaseModel):
    """Candidate ordering and report-only latency and embedding usage."""

    relevance_order: list[str]
    embedding_input_tokens: int
    estimated_cost_microdollars: int | None
    embedding_seconds: float


JobRelevanceContext = EvaluatorContext[
    JobRelevanceInputs, RankedJobs, JobRelevanceLabels
]


@dataclass
class JobRelevanceMetrics(Evaluator[JobRelevanceInputs, RankedJobs, JobRelevanceLabels]):
    """Compares relevance ordering with the manually arranged synthetic input order."""

    def evaluate(self, ctx: JobRelevanceContext) -> dict[str, float]:
        """Scores top-one hit, top-three precision, MRR, and hard-negative top one."""
        labels = ctx.metadata
        assert labels is not None
        fixture_ids = [listing.id for listing in ctx.inputs.listings]
        return compare_rankings(
            fixture_ids,
            ctx.output.relevance_order,
            labels.relevant_listing_ids,
            labels.hard_negative_listing_ids,
        )


JOB_RELEVANCE_EVALUATORS = (JobRelevanceMetrics,)
