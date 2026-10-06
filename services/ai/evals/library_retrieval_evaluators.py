"""
Description: Evaluators for career-library vector search. A case embeds one section's query
against synthetic library texts and checks that the relevant rows rank first and inside the
production limit.
Index:
    - LibraryDocument / RetrievalEvalInput / RetrievalEvalLabels: one case
    - RankedLibrary: document ids, nearest first
    - HitAt1 / RecallAtLimit: the scores
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
    """Document ids ordered from nearest to farthest."""

    ids: list[str]


RetrievalContext = EvaluatorContext[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels]


def labels_to_ranking(labels: RetrievalEvalLabels) -> RankedLibrary:
    """The ranking a perfect search would return: the relevant rows, nearest first."""
    return RankedLibrary(ids=list(labels.relevant_ids))


@dataclass
class HitAt1(Evaluator[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels]):
    """The nearest row is one the labels call relevant."""

    def evaluate(self, ctx: RetrievalContext) -> float:
        """1 when the first id is relevant."""
        labels = ctx.metadata
        assert labels is not None
        if not ctx.output.ids:
            return 0.0
        return 1.0 if ctx.output.ids[0] in labels.relevant_ids else 0.0


@dataclass
class RecallAtLimit(Evaluator[RetrievalEvalInput, RankedLibrary, RetrievalEvalLabels]):
    """Every relevant row is inside the number of neighbours production keeps."""

    def evaluate(self, ctx: RetrievalContext) -> float:
        """1 when each relevant id appears in the results production keeps."""
        labels = ctx.metadata
        assert labels is not None
        window = set(ctx.output.ids[:_LIMIT])
        return 1.0 if all(item in window for item in labels.relevant_ids) else 0.0


LIBRARY_RETRIEVAL_EVALUATORS = (HitAt1, RecallAtLimit)
