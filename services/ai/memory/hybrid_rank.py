"""Rank career evidence by combining cosine order and keyword matches.

Search and evaluation pass the same document records in nearest-first order.
This module owns the ID, text and distance projections needed for BM25 and
reciprocal rank fusion, so callers cannot misalign separate collections.
"""

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

RRF_K = 60
_K1 = 1.5
_B = 0.75
_TOKEN = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "as",
        "at",
        "by",
        "for",
        "from",
        "in",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
    }
)


@dataclass(frozen=True)
class RankedDocument:
    """One candidate's stable ID, embedded text, and cosine distance."""

    id: str
    content: str
    distance: float


def keyword_rank(query: str, documents: Sequence[tuple[str, str]]) -> list[str]:
    """Document ids with a BM25 score above zero, highest first. Tokens are lowercase
    words and numbers; English stopwords are dropped. No stemmer: embeddings cover
    inflection, and this list is for exact wording."""
    query_terms = list(dict.fromkeys(_tokens(query)))
    if not query_terms or not documents:
        return []
    counted = [(doc_id, _counts(_tokens(text))) for doc_id, text in documents]
    lengths = [sum(counts.values()) for _, counts in counted]
    average_length = sum(lengths) / len(lengths)
    if average_length == 0:
        return []
    document_frequency: dict[str, int] = {}
    for _, counts in counted:
        for term in counts:
            document_frequency[term] = document_frequency.get(term, 0) + 1
    scored: list[tuple[float, str]] = []
    for (doc_id, counts), length in zip(counted, lengths, strict=True):
        score = _bm25(query_terms, counts, length, average_length, len(counted), document_frequency)
        if score > 0:
            scored.append((score, doc_id))
    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    return [doc_id for _, doc_id in scored]


def reciprocal_rank_scores(rankings: Sequence[Sequence[str]], k: int = RRF_K) -> dict[str, float]:
    """Sums 1/(k + rank) for each id. Rank is 1-based. An id absent from a list adds nothing."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] = scores.get(item, 0.0) + 1 / (k + rank)
    return scores


def hybrid_order(
    documents: Sequence[RankedDocument],
    query_text: str,
) -> list[tuple[str, float]]:
    """Ids and fusion scores, best first. Input documents are in nearest-first cosine order.
    Equal scores keep the smaller cosine distance, then the id."""
    vector_ids = [document.id for document in documents]
    keyword_documents = [(document.id, document.content) for document in documents]
    distance_by_id = {document.id: document.distance for document in documents}
    scores = reciprocal_rank_scores([vector_ids, keyword_rank(query_text, keyword_documents)])
    ordered = sorted(
        vector_ids,
        key=lambda item: (-scores.get(item, 0.0), distance_by_id[item], item),
    )
    return [(item, scores.get(item, 0.0)) for item in ordered]


def _tokens(text: str) -> list[str]:
    """Lowercase words and numbers, without stopwords."""
    return [token for token in _TOKEN.findall(text.lower()) if token not in _STOPWORDS]


def _counts(tokens: Sequence[str]) -> dict[str, int]:
    """How many times each token appears."""
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    return counts


def _bm25(
    query_terms: Sequence[str],
    counts: Mapping[str, int],
    length: int,
    average_length: float,
    document_count: int,
    document_frequency: Mapping[str, int],
) -> float:
    """BM25 score of one document. A query term that no document contains adds nothing."""
    score = 0.0
    for term in query_terms:
        frequency = counts.get(term, 0)
        if frequency == 0:
            continue
        containing = document_frequency[term]
        idf = math.log(1 + (document_count - containing + 0.5) / (containing + 0.5))
        denominator = frequency + _K1 * (1 - _B + _B * length / average_length)
        score += idf * (frequency * (_K1 + 1)) / denominator
    return score
