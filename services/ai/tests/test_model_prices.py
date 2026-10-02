"""
Description: Tests for the per-model price table and cost estimates.
Index:
    - test_*: one behavior per test
"""

import pytest
from pydantic_ai.usage import RunUsage

from worker.model_prices import MODEL_PRICES, build_model_usage, estimate_cost_microdollars
from worker.settings import WorkerSettings


def test_every_configured_model_has_a_price() -> None:
    """A model chosen in settings can't silently be recorded as free."""
    settings = WorkerSettings()
    model_fields = [name for name in WorkerSettings.model_fields if name.endswith("_model")]

    assert model_fields
    for field_name in model_fields:
        assert getattr(settings, field_name) in MODEL_PRICES


def test_cost_prices_cached_input_separately() -> None:
    """Cached tokens are part of input_tokens but cost the cached rate."""
    usage = RunUsage(input_tokens=1_000_000, cache_read_tokens=400_000, output_tokens=100_000)

    # gpt-5-mini: 600k x $0.25/M + 400k x $0.025/M + 100k x $2.00/M = $0.36
    assert estimate_cost_microdollars("openai:gpt-5-mini", usage) == 360_000


def test_cost_rounds_up_to_a_whole_microdollar() -> None:
    """Tiny runs never round down to free."""
    usage = RunUsage(input_tokens=1, output_tokens=0)

    assert estimate_cost_microdollars("openai:gpt-5-mini", usage) == 1


def test_unknown_model_raises() -> None:
    """A model without a price fails loudly."""
    with pytest.raises(KeyError):
        estimate_cost_microdollars("openai:unknown-model", RunUsage(input_tokens=10))


def test_build_model_usage_reports_tokens_and_cost() -> None:
    """The ModelUsage entry carries the token counts and their cost."""
    usage = RunUsage(input_tokens=2_000, cache_read_tokens=500, output_tokens=300)

    model_usage = build_model_usage("openai:gpt-5-mini", usage)

    assert model_usage.model == "openai:gpt-5-mini"
    assert model_usage.input_tokens == 2_000
    assert model_usage.cached_input_tokens == 500
    assert model_usage.output_tokens == 300
    assert model_usage.cost_microdollars == estimate_cost_microdollars("openai:gpt-5-mini", usage)
