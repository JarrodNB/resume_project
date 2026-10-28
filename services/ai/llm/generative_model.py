"""Choose generative providers while keeping recovery policy separate from logging.

Provider errors can try a different configured model. A logging-owned observer
marks actual fallback execution without deciding when recovery should happen.
Timing spans identify primary and fallback attempts by their concrete model.
"""

from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel

from conversation_logging import observe_fallback_model
from llm.usage import accounted_model
from telemetry.model_attempt import ModelAttempt


def generative_model(primary: str, fallback: str) -> Model:
    """Returns the primary model, or a FallbackModel when fallback names a different model.

    FallbackModel switches on a provider error (rate limit, 5xx, connection). An output
    validation failure stays on the primary and uses that agent's retries. The same name for
    both skips the fallback so one model is not called twice.
    """
    primary_model = ModelAttempt(accounted_model(primary), role="primary")
    if fallback == primary:
        return primary_model
    fallback_model = observe_fallback_model(primary_model, accounted_model(fallback))
    return FallbackModel(primary_model, ModelAttempt(fallback_model, role="fallback"))
