"""Fuse job-text keyword matches with career-library similarity into an ordering.

The caller supplies scores from the current user's stored library embeddings.
The returned IDs are only a relative discovery order among supplied candidates.
"""

from collections.abc import Sequence
from math import isfinite

from memory.hybrid_rank import keyword_rank, reciprocal_rank_scores


def hybrid_listing_order(
    listings: Sequence[tuple[str, str]],
    similarities: Sequence[tuple[str, float]],
    keyword: str,
) -> list[str]:
    """Return an exact permutation; equal fusion scores keep semantic/provider order."""
    ids = [item[0] for item in listings]
    scores = dict(similarities)
    if (
        len(scores) != len(similarities)
        or set(scores) != set(ids)
        or any(not isfinite(score) for score in scores.values())
    ):
        raise ValueError("Library similarities must cover every listing exactly once")
    positions = {item: index for index, item in enumerate(ids)}
    semantic = sorted(ids, key=lambda item: (-scores[item], positions[item]))
    semantic_positions = {item: index for index, item in enumerate(semantic)}
    fusion = reciprocal_rank_scores([semantic, keyword_rank(keyword, listings)], k=60)
    return sorted(ids, key=lambda item: (-fusion[item], semantic_positions[item]))
