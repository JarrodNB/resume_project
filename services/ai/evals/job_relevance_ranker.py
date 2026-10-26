"""Rank synthetic job listings against a career library for an offline evaluation.

Each listing is compared with every career-library entry. Its score is the mean
cosine similarity to its three closest entries (or fewer when the library is
sparse). This score orders only the evaluation candidates; it is not a fit or
qualification measure and is never returned to the product UI.
"""

from dataclasses import dataclass
from math import sqrt
from typing import Sequence


@dataclass(frozen=True)
class RankingRecommendation:
    """A cautious recommendation about testing a relevance sort with people."""

    proceed: bool
    reasons: tuple[str, ...]


def rank_listings(
    listing_ids: Sequence[str],
    listing_vectors: Sequence[Sequence[float]],
    library_vectors: Sequence[Sequence[float]],
    evidence_limit: int = 3,
) -> list[str]:
    """Orders provider listings by their average similarity to their closest library entries.

    The input order is the provider order and breaks ties. An empty library has
    no evidence for reordering, so that order is returned unchanged.
    """
    if len(listing_ids) != len(listing_vectors):
        raise ValueError("Each listing id must have one vector")
    if evidence_limit < 1:
        raise ValueError("evidence_limit must be positive")
    if not library_vectors or not listing_ids:
        return list(listing_ids)

    dimensions = len(library_vectors[0])
    if dimensions == 0 or any(len(vector) != dimensions for vector in library_vectors):
        raise ValueError("All vectors must have the same number of dimensions")
    if any(len(vector) != dimensions for vector in listing_vectors):
        raise ValueError("All vectors must have the same number of dimensions")

    ranked = []
    for provider_position, (listing_id, listing_vector) in enumerate(
        zip(listing_ids, listing_vectors, strict=True)
    ):
        similarities = sorted(
            (_cosine_similarity(listing_vector, library_vector)
             for library_vector in library_vectors),
            reverse=True,
        )
        score = sum(similarities[:evidence_limit]) / min(evidence_limit, len(similarities))
        ranked.append((listing_id, score, provider_position))
    ranked.sort(key=lambda item: (-item[1], item[2]))
    return [listing_id for listing_id, _score, _position in ranked]


def ranking_scores(
    ranked_ids: Sequence[str],
    relevant_ids: Sequence[str],
    hard_negative_ids: Sequence[str],
    k: int = 3,
) -> dict[str, float]:
    """Scores top-one relevance, top-k precision, first relevant rank, and hard-negative top one."""
    if k < 1:
        raise ValueError("k must be positive")
    relevant = set(relevant_ids)
    hard_negatives = set(hard_negative_ids)
    window = ranked_ids[:k]
    top = ranked_ids[0] if ranked_ids else None
    reciprocal_rank = next(
        (1 / position for position, listing_id in enumerate(ranked_ids, start=1)
         if listing_id in relevant),
        0.0,
    )
    return {
        "hit_at_1": float(top in relevant),
        "precision_at_3": sum(listing_id in relevant for listing_id in window) / k,
        "mrr": reciprocal_rank,
        "hard_negative_at_1": float(top in hard_negatives),
    }


def compare_rankings(
    provider_ids: Sequence[str],
    relevance_ids: Sequence[str],
    relevant_ids: Sequence[str],
    hard_negative_ids: Sequence[str],
) -> dict[str, float]:
    """Returns aligned provider-order and relevance-order scores for one profile."""
    provider_scores = ranking_scores(provider_ids, relevant_ids, hard_negative_ids)
    relevance_scores = ranking_scores(relevance_ids, relevant_ids, hard_negative_ids)
    return {
        **{f"provider_{name}": value for name, value in provider_scores.items()},
        **{f"relevance_{name}": value for name, value in relevance_scores.items()},
    }


def ranking_recommendation(case_scores: Sequence[dict[str, float]]) -> RankingRecommendation:
    """Recommend a small user-facing pilot only when the ranking improves without regressions.

    Every labeled profile must be non-inferior on MRR and precision@3, and the
    mean of at least one metric must improve. The rate of hard negatives ranked
    first must not increase for any profile. Small synthetic fixtures are only
    a gate for formative testing, not evidence of broad product value.
    """
    if not case_scores:
        return RankingRecommendation(False, ("No labeled cases were evaluated.",))

    reasons: list[str] = []
    for name in ("mrr", "precision_at_3"):
        if any(
            case[f"relevance_{name}"] < case[f"provider_{name}"]
            for case in case_scores
        ):
            reasons.append(f"Relevance ordering regressed on at least one case for {name}.")
    if any(
        case["relevance_hard_negative_at_1"] > case["provider_hard_negative_at_1"]
        for case in case_scores
    ):
        reasons.append("A hard negative moved into first place on at least one case.")

    improved = any(
        sum(case[f"relevance_{name}"] for case in case_scores)
        > sum(case[f"provider_{name}"] for case in case_scores)
        for name in ("mrr", "precision_at_3")
    )
    if not improved:
        reasons.append("Neither MRR nor precision@3 improved over provider order.")
    return RankingRecommendation(not reasons, tuple(reasons or [
        "Ranking improved without a measured regression; proceed only to formative testing.",
    ]))


def _cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    """Returns cosine similarity, treating a zero vector as no similarity."""
    if len(left) != len(right):
        raise ValueError("All vectors must have the same number of dimensions")
    dot = sum(first * second for first, second in zip(left, right, strict=True))
    left_norm = sqrt(sum(value * value for value in left))
    right_norm = sqrt(sum(value * value for value in right))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0
