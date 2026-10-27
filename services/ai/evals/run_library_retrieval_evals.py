"""
Description: Ranks synthetic library texts with the production hybrid ranker and reports
average retrieval scores to Logfire. Documents are embedded the way Rails stores them;
each case supplies an explicit search query. Cosine order is fused with BM25
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
from pydantic_evals.reporting import EvaluationReport

from evals.library_retrieval_evaluators import (
    LIBRARY_RETRIEVAL_EVALUATORS,
    RankedLibrary,
    RetrievalEvalInput,
    RetrievalEvalLabels,
)
from evals.report_capture import override_settings
from evals.telemetry import evaluate_dataset
from memory.embed_search_query import embed_search_query
from memory.hybrid_rank import RankedDocument, hybrid_order
from settings import load_settings

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
    """Hybrid-ranked document ids for the case's explicit search query."""
    embedder = Embedder(model, settings=EmbeddingSettings(dimensions=dimensions))
    embedded = embedder.embed_documents_sync([document.content for document in case.documents])
    query_text = case.query_text
    query = embed_search_query(query_text, model, dimensions)
    similarities = {
        document.id: _cosine_similarity(query.vector, list(vector))
        for document, vector in zip(case.documents, embedded.embeddings, strict=True)
    }
    documents = [
        RankedDocument(document.id, document.content, 1 - similarities[document.id])
        for document in case.documents
    ]
    documents.sort(key=lambda document: similarities[document.id], reverse=True)
    ordered = hybrid_order(documents, query_text)
    return RankedLibrary(ids=[doc_id for doc_id, _score in ordered])


def run_library_retrieval_evals(model_override: str | None = None) -> EvaluationReport:
    """Evaluates retrieval on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "embedding_model", model_override)
    model = settings.embedding_model
    dimensions = settings.embedding_dimensions

    def rank_case(case: RetrievalEvalInput) -> RankedLibrary:
        """The task under evaluation: one query against its library."""
        return rank_library(case, model, dimensions)

    return evaluate_dataset(
        load_library_retrieval_dataset,
        rank_case,
        name=TRACE_NAME,
        metadata={"model": model, "dimensions": dimensions},
        tags=["eval", "library_retrieval", model],
        evaluation_name=f"library_retrieval:{model}",
        max_concurrency=2,
    )


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
