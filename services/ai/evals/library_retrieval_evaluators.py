"""
Description: Evaluators for career-library hybrid search. A case ranks one section's query
against synthetic library texts and scores recall@k, precision@k, and MRR inside the
production limit.
Index:
    - LibraryDocument / RetrievalEvalInput / RetrievalEvalLabels: one case
    - RankedLibrary: document ids, best first
    - retrieval_scores: recall@k, precision@k, and reciprocal rank of the first hit
    - HitAt1 / RecallAtK / PrecisionAtK / MeanReciprocalRank: the scores
    - labels_to_ranking: the ranking the hand labels describe
    - LIBRARY_RETRIEVAL_EVALUATORS: the classes Dataset.from_file needs
"""

from dataclasses import dataclass

from pydantic import BaseModel, Field
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from schemas.gap_analysis_context import JobToAnalyze
from tailoring.retrieve_for_section import _LIMIT


class LibraryDocument(BaseModel):
    """One library row, in the text shape Rails embeds."""

    id: str
    content: str


class RetrievalEvalInput(BaseModel):
    """A section query and the library it searches."""

    section_type: str
    job: JobToAnalyze
    documents: list[LibraryDocument]


class RetrievalEvalLabels(BaseModel):
    """Document ids that belong in the results for this query."""

    relevant_ids: list[str] = Field(default_factory=list)


class RankedLibrary(BaseModel):
    """Document ids, best match first."""

    ids: list[str]


def retrieval_scores(ids: list[str], relevant_ids: list[str], k: int) -> dict[str, float]:
    """Recall@k, precision@k, and the reciprocal rank of the first relevant id inside k.
    Precision divides by the number of returned rows when that is shorter than k, so a list
    of only the relevant rows scores 1."""
    window = ids[:k]
    relevant = set(relevant_ids)
    hits = len(set(window) & relevant)
    precision = hits / len(window) if window else 0.0
    recall = hits / len(relevant) if relevant else 1.0
    reciprocal = 0.0
    for index, item in enumerate(window, start=1):
        if item in relevant:
            reciprocal = 1 / index
            break
    return {"recall": recall, "precision": precision, "mrr": reciprocal}


RetrievalContext = EvaluatorContext[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels]


def labels_to_ranking(labels: RetrievalEvalLabels) -> RankedLibrary:
    """The ranking a perfect search would return: the relevant rows, best first."""
    return RankedLibrary(ids=list(labels.relevant_ids))


@dataclass
class HitAt1(Evaluator[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels]):
    """The first row is one the labels call relevant."""

    def evaluate(self, ctx: RetrievalContext) -> float:
        """1 when the first id is relevant."""
        labels = ctx.metadata
        assert labels is not None
        if not ctx.output.ids:
            return 0.0
        return 1.0 if ctx.output.ids[0] in labels.relevant_ids else 0.0


@dataclass
class RecallAtK(Evaluator[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels]):
    """Share of relevant rows inside the number of neighbours production keeps."""

    def evaluate(self, ctx: RetrievalContext) -> float:
        """|relevant ∩ top k| / |relevant|."""
        return _score(ctx, "recall")


@dataclass
class PrecisionAtK(Evaluator[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels]):
    """Share of the kept neighbours that the labels call relevant."""

    def evaluate(self, ctx: RetrievalContext) -> float:
        """|relevant ∩ top k| / |top k|."""
        return _score(ctx, "precision")


@dataclass
class MeanReciprocalRank(Evaluator[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels]):
    """Reciprocal rank of the first relevant row inside the production limit."""

    def evaluate(self, ctx: RetrievalContext) -> float:
        """1/rank of the first hit, or 0 when none of the kept rows is relevant."""
        return _score(ctx, "mrr")


def _score(ctx: RetrievalContext, name: str) -> float:
    """One retrieval metric for this case."""
    labels = ctx.metadata
    assert labels is not None
    return retrieval_scores(ctx.output.ids, labels.relevant_ids, _LIMIT)[name]


LIBRARY_RETRIEVAL_EVALUATORS = (HitAt1, RecallAtK, PrecisionAtK, MeanReciprocalRank)
