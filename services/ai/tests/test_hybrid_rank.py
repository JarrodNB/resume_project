"""
Description: Deterministic checks for production hybrid ranking. No embeddings and no Postgres.
k=60 is the fusion constant because a row that both lists rank well beats a row that is
first on only one.
Index:
    - test_exact_term_outranks_a_nearer_row
    - test_no_shared_term_keeps_cosine_order
    - test_stopwords_do_not_match
    - test_k_60_prefers_agreement_over_a_single_first_place
"""

import pytest

from memory.hybrid_rank import (
    RRF_K,
    RankedDocument,
    hybrid_order,
    keyword_rank,
    reciprocal_rank_scores,
)


def test_exact_term_outranks_a_nearer_row() -> None:
    """The row that contains the query word ranks first even when cosine prefers another."""
    documents = [
        RankedDocument("semantic", "Built compliance reviews for customer contracts", 0.1),
        RankedDocument("exact", "Completed the Terraform rollout for staging", 0.4),
    ]
    ordered = hybrid_order(
        documents,
        "Terraform",
    )

    assert ordered[0][0] == "exact"
    assert ordered[0][1] > ordered[1][1]


def test_no_shared_term_keeps_cosine_order() -> None:
    """A query that matches no row leaves the cosine order in place."""
    ordered = hybrid_order(
        [RankedDocument("semantic", "Built compliance reviews", 0.1),
         RankedDocument("exact", "Terraform rollout", 0.4)],
        "zzzzqqq",
    )

    assert [item for item, _score in ordered] == ["semantic", "exact"]


@pytest.mark.parametrize("query", ["go", "Go", "GO", "java", "Java", "JAVA"])
def test_skill_keywords_match_whole_words_regardless_of_case(query: str) -> None:
    """Django and JavaScript must not crowd out exact Go and Java experience."""
    documents = [
        RankedDocument("nearer", "Built Django and JavaScript services", 0.1),
        RankedDocument("exact", "Built Go and Java services", 0.4),
    ]

    assert keyword_rank(query, [(doc.id, doc.content) for doc in documents]) == ["exact"]
    ordered = hybrid_order(documents, query)
    assert [item for item, _score in ordered] == ["exact", "nearer"]
    assert ordered[0][1] > ordered[1][1]


def test_stopwords_do_not_match() -> None:
    """Words such as "at" are not a keyword hit."""
    assert keyword_rank("at the", [("role", "Engineer at Acme")]) == []


def test_empty_candidates_have_no_matches() -> None:
    assert hybrid_order([], "Terraform") == []


def test_equal_fusion_scores_break_ties_by_distance_then_id() -> None:
    candidates = [RankedDocument("b", "Terraform", 0.1), RankedDocument("a", "Terraform", 0.4)]
    assert [item for item, _score in hybrid_order(candidates, "Terraform")] == ["b", "a"]
    candidates = [RankedDocument("b", "Terraform", 0.1), RankedDocument("a", "Terraform", 0.1)]
    assert [item for item, _score in hybrid_order(candidates, "Terraform")] == ["a", "b"]


def test_k_60_prefers_agreement_over_a_single_first_place() -> None:
    """k=60 ranks the row both lists like above the row that is only first on one list.
    k=1 does the opposite, which is why production uses 60."""
    vector = ["spike", "p2", "p3", "p4", "balanced"]
    keyword = ["other", "balanced", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "spike"]

    agreed = reciprocal_rank_scores([vector, keyword], k=RRF_K)
    sharp = reciprocal_rank_scores([vector, keyword], k=1)

    assert RRF_K == 60
    assert agreed["balanced"] > agreed["spike"]
    assert sharp["spike"] > sharp["balanced"]
