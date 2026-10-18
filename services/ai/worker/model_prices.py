"""
Description: Per-model token prices and the cost estimate reported with every task result
(Rails sums these to enforce each user's monthly budget).
Index:
    - ModelPrice: USD per 1M tokens for uncached input, cached input, and output
    - MODEL_PRICES: price table keyed by the Pydantic AI model name (e.g. "openai:gpt-6-luna")
    - estimate_cost_microdollars: cost of one run's usage, in millionths of a dollar
    - build_model_usage: the ModelUsage entry a result message reports for one agent run
    - reported_model_name: the priced name to bill (the response's model, or the setting)
"""

import math
from typing import NamedTuple

from pydantic_ai.usage import RunUsage

from worker.queue_messages import ModelUsage


class ModelPrice(NamedTuple):
    """USD per 1M tokens."""

    input: float
    cached_input: float
    output: float


# Standard (non-batch) rates from https://developers.openai.com/api/docs/pricing, checked
# 2026-10-02. A model missing here fails the task loudly instead of being recorded as free.
MODEL_PRICES: dict[str, ModelPrice] = {
    "openai:gpt-5-mini": ModelPrice(input=0.25, cached_input=0.025, output=2.00),
    # Standard rates from https://developers.openai.com/api/docs/pricing, checked 2026-10-18.
    "openai:gpt-6-luna": ModelPrice(input=0.10, cached_input=0.01, output=0.50),
    "openai:gpt-5": ModelPrice(input=1.25, cached_input=0.125, output=10.00),
    "openai:gpt-5-nano": ModelPrice(input=0.05, cached_input=0.005, output=0.40),
    # Embeddings bill input tokens only.
    "openai:text-embedding-3-small": ModelPrice(input=0.02, cached_input=0.02, output=0.0),
    # TypeSafe Jev, https://docs.typesafe.ai/models checked 2026-10-05: $0.042 per 1M input
    # tokens ($42 per billion); output is free ("too cheap to meter"). No cached-input rate is
    # published, so cached input uses the input rate. The worker asks for typesafe:jev-1.13.0.
    # The API may report that id as jev-1.13.0. `jev-latest` stays priced so an old env override
    # is not recorded as free.
    "typesafe:jev-latest": ModelPrice(input=0.042, cached_input=0.042, output=0.0),
    "typesafe:jev-1.13.0": ModelPrice(input=0.042, cached_input=0.042, output=0.0),
    "jev-1.13.0": ModelPrice(input=0.042, cached_input=0.042, output=0.0),
}


def reported_model_name(response_model_name: str, configured_model: str) -> str:
    """Bills the version the API named when that name has a price; otherwise the setting."""
    if response_model_name in MODEL_PRICES:
        return response_model_name
    return configured_model


def estimate_cost_microdollars(model: str, usage: RunUsage) -> int:
    """Returns the cost of the usage in micro-dollars, rounded up. Raises KeyError for a model
    without a price."""
    price = MODEL_PRICES[model]
    cached_input_tokens = usage.cache_read_tokens
    uncached_input_tokens = max(usage.input_tokens - cached_input_tokens, 0)
    # USD per 1M tokens times tokens is exactly micro-dollars.
    cost = (
        uncached_input_tokens * price.input
        + cached_input_tokens * price.cached_input
        + usage.output_tokens * price.output
    )
    return math.ceil(cost)


def build_model_usage(model: str, usage: RunUsage) -> ModelUsage:
    """Converts one agent run's usage into the token counts and cost sent to Rails."""
    return ModelUsage(
        model=model,
        input_tokens=usage.input_tokens,
        cached_input_tokens=usage.cache_read_tokens,
        output_tokens=usage.output_tokens,
        cost_microdollars=estimate_cost_microdollars(model, usage),
    )
