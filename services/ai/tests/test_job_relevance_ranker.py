"""Check job relevance ranking and its go/no-go rule without provider calls."""

import unittest

from evals.job_relevance_ranker import (
    compare_rankings,
    rank_listings,
    ranking_recommendation,
)


class JobRelevanceRankerTests(unittest.TestCase):
    def test_ranks_listings_by_mean_of_their_best_library_matches(self):
        ranking = rank_listings(
            listing_ids=["provider-first", "relevant", "adjacent"],
            listing_vectors=[[0, 0, 1], [1, 1, 0], [1, 0, 0]],
            library_vectors=[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        )

        self.assertEqual(ranking, ["relevant", "provider-first", "adjacent"])

    def test_keeps_provider_order_for_equal_scores(self):
        ranking = rank_listings(
            listing_ids=["first", "second"],
            listing_vectors=[[1, 0], [0, 1]],
            library_vectors=[[1, 1]],
        )

        self.assertEqual(ranking, ["first", "second"])

    def test_empty_library_returns_provider_order(self):
        ranking = rank_listings(
            listing_ids=["first", "second"],
            listing_vectors=[[1, 0], [0, 1]],
            library_vectors=[],
        )

        self.assertEqual(ranking, ["first", "second"])

    def test_rejects_mismatched_vector_dimensions(self):
        with self.assertRaisesRegex(ValueError, "same number of dimensions"):
            rank_listings(
                listing_ids=["role"], listing_vectors=[[1, 0]], library_vectors=[[1, 0, 0]]
            )

    def test_recommendation_requires_improvement_without_regressions(self):
        result = ranking_recommendation([
            {"provider_mrr": 0.5, "relevance_mrr": 1.0,
             "provider_precision_at_3": 1 / 3, "relevance_precision_at_3": 2 / 3,
             "provider_hard_negative_at_1": 0, "relevance_hard_negative_at_1": 0},
        ])

        self.assertTrue(result.proceed)

    def test_recommendation_is_no_go_when_ranking_promotes_a_hard_negative(self):
        result = ranking_recommendation([
            {"provider_mrr": 1.0, "relevance_mrr": 0.5,
             "provider_precision_at_3": 2 / 3, "relevance_precision_at_3": 1 / 3,
             "provider_hard_negative_at_1": 0, "relevance_hard_negative_at_1": 1},
        ])

        self.assertFalse(result.proceed)
        self.assertTrue(result.reasons)

    def test_recommendation_needs_cases(self):
        result = ranking_recommendation([])

        self.assertFalse(result.proceed)

    def test_comparison_scores_provider_and_relevance_orders_with_hard_negatives(self):
        scores = compare_rankings(
            ["false-positive", "relevant", "other-relevant"],
            ["relevant", "other-relevant", "false-positive"],
            ["relevant", "other-relevant"],
            ["false-positive"],
        )

        self.assertEqual(scores["provider_hit_at_1"], 0.0)
        self.assertEqual(scores["provider_mrr"], 0.5)
        self.assertEqual(scores["relevance_hit_at_1"], 1.0)
        self.assertEqual(scores["relevance_precision_at_3"], 2 / 3)
        self.assertEqual(scores["provider_hard_negative_at_1"], 1.0)
        self.assertEqual(scores["relevance_hard_negative_at_1"], 0.0)


if __name__ == "__main__":
    unittest.main()
