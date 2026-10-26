"""Check job relevance ranking and comparison metrics without provider calls."""

import unittest

from evals.job_relevance_ranker import (
    compare_rankings,
    rank_listings,
)


class JobRelevanceRankerTests(unittest.TestCase):
    def test_ranks_listings_by_mean_of_their_best_library_matches(self):
        ranking = rank_listings(
            listing_ids=["fixture-first", "relevant", "adjacent"],
            listing_vectors=[[0, 0, 1], [1, 1, 0], [1, 0, 0]],
            library_vectors=[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        )

        self.assertEqual(ranking, ["relevant", "fixture-first", "adjacent"])

    def test_keeps_fixture_order_for_equal_scores(self):
        ranking = rank_listings(
            listing_ids=["first", "second"],
            listing_vectors=[[1, 0], [0, 1]],
            library_vectors=[[1, 1]],
        )

        self.assertEqual(ranking, ["first", "second"])

    def test_empty_library_returns_fixture_order(self):
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

    def test_comparison_scores_fixture_and_relevance_orders_with_hard_negatives(self):
        scores = compare_rankings(
            ["false-positive", "relevant", "other-relevant"],
            ["relevant", "other-relevant", "false-positive"],
            ["relevant", "other-relevant"],
            ["false-positive"],
        )

        self.assertEqual(scores["fixture_hit_at_1"], 0.0)
        self.assertEqual(scores["fixture_mrr"], 0.5)
        self.assertEqual(scores["relevance_hit_at_1"], 1.0)
        self.assertEqual(scores["relevance_precision_at_3"], 2 / 3)
        self.assertEqual(scores["fixture_hard_negative_at_1"], 1.0)
        self.assertEqual(scores["relevance_hard_negative_at_1"], 0.0)


if __name__ == "__main__":
    unittest.main()
