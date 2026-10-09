"""
Description: Hybrid rank for career-library search. Cosine order (from pgvector) and a BM25
keyword order are fused with reciprocal rank fusion. The same function orders the
library-retrieval eval, so the golden set measures production ranking.
Index:
    - RRF_K: fusion constant (60). A row that ranks well on both lists beats one that is
      first on only one
    - keyword_rank: BM25 order of document ids that share a query term
    - reciprocal_rank_scores: 1/(k + rank) summed across ranked lists
    - hybrid_order: fused ids and scores, best first
"""

import math
import re
from collections.abc import Mapping, Sequence

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
    vector_ids: Sequence[str],
    documents: Sequence[tuple[str, str]],
    query_text: str,
    distance_by_id: Mapping[str, float],
) -> list[tuple[str, float]]:
    """Ids and fusion scores, best first. `vector_ids` is nearest-first cosine order.
    Equal scores keep the smaller cosine distance, then the id."""
    scores = reciprocal_rank_scores([list(vector_ids), keyword_rank(query_text, documents)])
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
