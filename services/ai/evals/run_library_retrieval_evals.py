"""
Description: Ranks synthetic library texts with the production embedding model and reports
average retrieval scores to Langfuse. Documents are embedded the way Rails stores them;
the query is the same text the worker searches with.
Run: docker compose run --rm ai python -m evals.run_library_retrieval_evals
Index:
    - load_library_retrieval_dataset: reads the YAML cases
    - rank_library: cosine-nearest document ids for one case
    - run_library_retrieval_evals: evaluates every case
"""

from pathlib import Path

from langfuse import get_client, propagate_attributes
from pydantic_ai import Embedder
from pydantic_ai.embeddings import EmbeddingSettings
from pydantic_evals import Dataset

from evals.library_retrieval_evaluators import (
    LIBRARY_RETRIEVAL_EVALUATORS,
    RankedLibrary,
    RetrievalEvalInput,
    RetrievalEvalLabels,
)
from memory.embed_search_query import embed_search_query
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
    """Nearest document ids for this section's production query."""
    embedder = Embedder(model, settings=EmbeddingSettings(dimensions=dimensions))
    embedded = embedder.embed_documents_sync([document.content for document in case.documents])
    query = embed_search_query(section_query(case.section_type, case.job), model, dimensions)
    ranked = sorted(
        zip(case.documents, embedded.embeddings, strict=True),
        key=lambda pair: _cosine_similarity(query.vector, list(pair[1])),
        reverse=True,
    )
    return RankedLibrary(ids=[document.id for document, _vector in ranked])


def run_library_retrieval_evals() -> None:
    """Evaluates retrieval on every case and records the average scores in Langfuse."""
    settings = load_settings()
    configure_tracing()
    langfuse = get_client()
    model = settings.embedding_model
    dimensions = settings.embedding_dimensions

    def rank_case(case: RetrievalEvalInput) -> RankedLibrary:
        """The task under evaluation: one section query against its library."""
        return rank_library(case, model, dimensions)

    with (
        langfuse.start_as_current_observation(
            name=TRACE_NAME, metadata={"model": model, "dimensions": dimensions}
        ),
        propagate_attributes(trace_name=TRACE_NAME, tags=["eval", "library_retrieval", model]),
    ):
        report = load_library_retrieval_dataset().evaluate_sync(
            rank_case, name=f"library_retrieval:{model}", max_concurrency=2
        )
        for score_name, average in report.averages().scores.items():
            langfuse.score_current_trace(name=score_name, value=average)

    report.print(include_input=False, include_output=False, include_durations=True)
    langfuse.flush()


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
