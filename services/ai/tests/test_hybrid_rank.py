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

from memory.hybrid_rank import RRF_K, hybrid_order, keyword_rank, reciprocal_rank_scores


def test_exact_term_outranks_a_nearer_row() -> None:
    """The row that contains the query word ranks first even when cosine prefers another."""
    documents = [
        ("semantic", "Built compliance reviews for customer contracts"),
        ("exact", "Completed the Terraform rollout for staging"),
    ]
    ordered = hybrid_order(
        ["semantic", "exact"],
        documents,
        "Terraform",
        {"semantic": 0.1, "exact": 0.4},
    )

    assert ordered[0][0] == "exact"
    assert ordered[0][1] > ordered[1][1]


def test_no_shared_term_keeps_cosine_order() -> None:
    """A query that matches no row leaves the cosine order in place."""
    ordered = hybrid_order(
        ["semantic", "exact"],
        [("semantic", "Built compliance reviews"), ("exact", "Terraform rollout")],
        "zzzzqqq",
        {"semantic": 0.1, "exact": 0.4},
    )

    assert [item for item, _score in ordered] == ["semantic", "exact"]


def test_stopwords_do_not_match() -> None:
    """Words such as "at" are not a keyword hit."""
    assert keyword_rank("at the", [("role", "Engineer at Acme")]) == []


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
