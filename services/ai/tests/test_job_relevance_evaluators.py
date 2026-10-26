"""Check the synthetic job ranking runner without paid embedding calls."""

from pydantic_ai.embeddings import TestEmbeddingModel

from evals.run_job_relevance_evals import load_job_relevance_dataset, rank_job_listings


def test_labeled_cases_have_multiple_profiles_and_explicit_hard_negatives():
    """The set includes sparse evidence and plausible false positives."""
    cases = load_job_relevance_dataset().cases

    assert len(cases) >= 3
    assert len({case.inputs.profile_id for case in cases}) == len(cases)
    assert any(len(case.inputs.career_library) == 1 for case in cases)
    assert all(case.metadata and case.metadata.hard_negative_listing_ids for case in cases)
    for case in cases:
        listing_ids = {listing.id for listing in case.inputs.listings}
        assert set(case.metadata.relevant_listing_ids) <= listing_ids
        assert set(case.metadata.hard_negative_listing_ids) <= listing_ids
        assert not (set(case.metadata.relevant_listing_ids)
                    & set(case.metadata.hard_negative_listing_ids))


def test_runner_uses_fake_embeddings_and_returns_each_listing_once():
    """Offline embeddings exercise the same runner path without contacting a provider."""
    cases = load_job_relevance_dataset().cases
    model = TestEmbeddingModel(dimensions=16)

    for case in cases:
        result = rank_job_listings(case.inputs, model, 16)

        assert sorted(result.relevance_order) == sorted(
            listing.id for listing in case.inputs.listings
        )
        assert result.embedding_seconds >= 0
        assert result.estimated_cost_microdollars is None
