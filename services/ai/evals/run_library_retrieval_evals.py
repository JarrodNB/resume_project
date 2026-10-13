"""
Description: Ranks synthetic library texts with the production hybrid ranker and reports
average retrieval scores to Logfire. Documents are embedded the way Rails stores them;
the query is the same text the worker searches with. Cosine order is fused with BM25
the same way database/library_embedding_search.py does (no Postgres).
Run: docker compose run --rm ai python -m evals.run_library_retrieval_evals
Index:
    - load_library_retrieval_dataset: reads the YAML cases
    - rank_library: hybrid-ranked document ids for one case
    - run_library_retrieval_evals: evaluates every case
"""

from pathlib import Path

from pydantic_ai import Embedder
from pydantic_ai.embeddings import EmbeddingSettings
from pydantic_evals import Dataset

from evals.library_retrieval_evaluators import (
    LIBRARY_RETRIEVAL_EVALUATORS,
    RankedLibrary,
    RetrievalEvalInput,
    RetrievalEvalLabels,
)
from evals.report_capture import capture_report, override_settings
from evals.telemetry import eval_run, record_score
from memory.embed_search_query import embed_search_query
from memory.hybrid_rank import hybrid_order
from tailoring.retrieve_for_section import section_query
from worker.settings import load_settings
from worker.tracing import configure_tracing

DATASET_PATH = Path(__file__).parent / "datasets" / "library_retrieval_cases.yaml"
TRACE_NAME = "evals.library_retrieval"


def load_library_retrieval_dataset() -> Dataset[
    RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels
]:
    """Loads the labelled retrieval cases."""
    return Dataset[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels].from_file(
        DATASET_PATH, custom_evaluator_types=LIBRARY_RETRIEVAL_EVALUATORS
    )


def rank_library(case: RetrievalEvalInput, model: str, dimensions: int) -> RankedLibrary:
    """Hybrid-ranked document ids for this section's production query."""
    embedder = Embedder(model, settings=EmbeddingSettings(dimensions=dimensions))
    embedded = embedder.embed_documents_sync([document.content for document in case.documents])
    query_text = section_query(case.section_type, case.job)
    query = embed_search_query(query_text, model, dimensions)
    similarities = {
        document.id: _cosine_similarity(query.vector, list(vector))
        for document, vector in zip(case.documents, embedded.embeddings, strict=True)
    }
    vector_ids = sorted(similarities, key=lambda doc_id: similarities[doc_id], reverse=True)
    documents = [(document.id, document.content) for document in case.documents]
    distances = {doc_id: 1 - similarity for doc_id, similarity in similarities.items()}
    ordered = hybrid_order(vector_ids, documents, query_text, distances)
    return RankedLibrary(ids=[doc_id for doc_id, _score in ordered])


def run_library_retrieval_evals(model_override: str | None = None) -> None:
    """Evaluates retrieval on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "embedding_model", model_override)
    configure_tracing()
    model = settings.embedding_model
    dimensions = settings.embedding_dimensions

    def rank_case(case: RetrievalEvalInput) -> RankedLibrary:
        """The task under evaluation: one section query against its library."""
        return rank_library(case, model, dimensions)

    with eval_run(
        name=TRACE_NAME,
        metadata={"model": model, "dimensions": dimensions},
        tags=["eval", "library_retrieval", model],
    ):
        report = load_library_retrieval_dataset().evaluate_sync(
            rank_case, name=f"library_retrieval:{model}", max_concurrency=2
        )
        capture_report(report)
        for score_name, average in report.averages().scores.items():
            record_score(name=score_name, value=average)

    report.print(include_input=False, include_output=False, include_durations=True)


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    """Cosine similarity. pgvector `<=>` is one minus this, so nearest-first matches."""
    dot = sum(first * second for first, second in zip(left, right, strict=True))
    left_norm = sum(value * value for value in left) ** 0.5
    right_norm = sum(value * value for value in right) ** 0.5
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


if __name__ == "__main__":
    run_library_retrieval_evals()
