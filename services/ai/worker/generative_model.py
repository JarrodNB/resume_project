"""
Description: The OpenAI model a generative agent runs, with a fallback for provider errors.
Index:
    - generative_model: the primary model, or a FallbackModel when the fallback name differs
"""

from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel

from worker.task_usage import accounted_model


def generative_model(primary: str, fallback: str) -> Model | str:
    """Returns the primary model, or a FallbackModel when fallback names a different model.

    FallbackModel switches on a provider error (rate limit, 5xx, connection). An output
    validation failure stays on the primary and uses that agent's retries. The same name for
    both skips the fallback so one model is not called twice.
    """
    if fallback == primary:
        return accounted_model(primary)
    return FallbackModel(accounted_model(primary), accounted_model(fallback))
