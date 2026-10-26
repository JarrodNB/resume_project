"""Compare library-based job ordering with the synthetic input order on synthetic roles.

The runner embeds only synthetic fixture text and calls the configured embedding
provider, so an explicit run can cost money. Ordinary tests use deterministic
vectors. It reports relative ordering metrics, never a qualification percentage.
"""

from pathlib import Path
from time import perf_counter

from pydantic_ai import Embedder
from pydantic_ai.embeddings import EmbeddingModel, EmbeddingSettings
from pydantic_ai.usage import RunUsage
from pydantic_evals import Dataset
from pydantic_evals.reporting import EvaluationReport

from evals.job_relevance_evaluators import (
    JOB_RELEVANCE_EVALUATORS,
    JobRelevanceInputs,
    JobRelevanceLabels,
    RankedJobs,
)
from evals.job_relevance_ranker import compare_rankings, rank_listings
from evals.report_capture import override_settings
from evals.telemetry import evaluate_dataset
from worker.model_prices import MODEL_PRICES, estimate_cost_microdollars
from worker.settings import load_settings

DATASET_PATH = Path(__file__).parent / "datasets" / "job_relevance_cases.yaml"
TRACE_NAME = "evals.job_relevance"
EVIDENCE_LIMIT = 3


def load_job_relevance_dataset() -> Dataset[
    JobRelevanceInputs, RankedJobs, JobRelevanceLabels
]:
    """Loads the hand-labeled, synthetic career and listing cases."""
    return Dataset[JobRelevanceInputs, RankedJobs, JobRelevanceLabels].from_file(
        DATASET_PATH, custom_evaluator_types=JOB_RELEVANCE_EVALUATORS
    )


def rank_job_listings(
    inputs: JobRelevanceInputs,
    model: EmbeddingModel | str,
    dimensions: int,
) -> RankedJobs:
    """Embeds one profile's library and its listings, then returns relative ordering and cost."""
    embedder = Embedder(model, settings=EmbeddingSettings(dimensions=dimensions))
    started = perf_counter()
    library_embeddings = embedder.embed_documents_sync(
        [entry.content for entry in inputs.career_library]
    )
    listing_embeddings = embedder.embed_documents_sync(
        [listing.content for listing in inputs.listings]
    )
    elapsed = perf_counter() - started
    library_vectors = [list(vector) for vector in library_embeddings.embeddings]
    listing_vectors = [list(vector) for vector in listing_embeddings.embeddings]
    fixture_ids = [listing.id for listing in inputs.listings]
    relevance_order = rank_listings(fixture_ids, listing_vectors, library_vectors, EVIDENCE_LIMIT)

    input_tokens = library_embeddings.usage.input_tokens + listing_embeddings.usage.input_tokens
    estimated_cost = None
    if isinstance(model, str) and model in MODEL_PRICES:
        estimated_cost = estimate_cost_microdollars(model, RunUsage(input_tokens=input_tokens))
    return RankedJobs(
        relevance_order=relevance_order,
        embedding_input_tokens=input_tokens,
        estimated_cost_microdollars=estimated_cost,
        embedding_seconds=elapsed,
    )


def run_job_relevance_evals(model_override: str | None = None) -> EvaluationReport:
    """Evaluates each profile, compares both orders, without making a product recommendation."""
    settings = override_settings(load_settings(), "embedding_model", model_override)
    model = settings.embedding_model
    dimensions = settings.embedding_dimensions
    dataset = load_job_relevance_dataset()
    outputs: dict[str, RankedJobs] = {}

    def rank_case(inputs: JobRelevanceInputs) -> RankedJobs:
        """One synthetic-input-ordered job set against one synthetic career library."""
        result = rank_job_listings(inputs, model, dimensions)
        outputs[inputs.profile_id] = result
        return result

    report = evaluate_dataset(
        lambda: dataset,
        rank_case,
        name=TRACE_NAME,
        metadata={
            "model": model,
            "dimensions": dimensions,
            "ordering_method": "mean cosine similarity to the three closest library entries",
            "evaluation_limit": EVIDENCE_LIMIT,
        },
        tags=["eval", "job_relevance", model],
        evaluation_name=f"job_relevance:{model}",
        max_concurrency=1,
    )

    print("\nEmbedding usage by synthetic profile (synthetic input order is the baseline):")
    for case in dataset.cases:
        labels = case.metadata
        assert labels is not None
        fixture_ids = [listing.id for listing in case.inputs.listings]
        result = outputs.get(case.inputs.profile_id)
        if result is None:
            print(f"- {case.inputs.profile_id}: ranking failed; comparison is unavailable.")
            continue
        scores = compare_rankings(
            fixture_ids,
            result.relevance_order,
            labels.relevant_listing_ids,
            labels.hard_negative_listing_ids,
        )
        cost = (
            f"${result.estimated_cost_microdollars / 1_000_000:.6f}"
            if result.estimated_cost_microdollars is not None else "unknown"
        )
        print(
            f"- {case.inputs.profile_id}: input tokens={result.embedding_input_tokens}, "
            f"estimated embedding cost={cost}, "
            f"embedding latency={result.embedding_seconds:.3f}s"
        )
        print(f"  Synthetic input order: {fixture_ids}")
        print(f"  Library relevance order: {result.relevance_order}")
        print(f"  Comparison: {scores}")

    print("\nProduct decision: NOT EVALUATED.")
    print("These manually ordered synthetic fixtures are algorithm checks, not a captured job-provider baseline.")
    print("Real search results, independent labels, and alternative methods are needed before choosing a product algorithm.")
    return report


if __name__ == "__main__":
    run_job_relevance_evals()
