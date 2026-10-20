"""Choose generative providers while keeping recovery policy separate from logging.

Provider errors can try a different configured model. A logging-owned observer
marks actual fallback execution without deciding when recovery should happen.
"""

from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel

from conversation_logging import observe_fallback_model
from worker.task_usage import accounted_model


def generative_model(primary: str, fallback: str) -> Model | str:
    """Returns the primary model, or a FallbackModel when fallback names a different model.

    FallbackModel switches on a provider error (rate limit, 5xx, connection). An output
    validation failure stays on the primary and uses that agent's retries. The same name for
    both skips the fallback so one model is not called twice.
    """
    if fallback == primary:
        return accounted_model(primary)
    primary_model, fallback_model = accounted_model(primary), accounted_model(fallback)
    return FallbackModel(primary_model, observe_fallback_model(primary_model, fallback_model))
