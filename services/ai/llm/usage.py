"""
Description: Attempt-scoped provider accounting independent of handler outcomes and telemetry.
Index:
    - TaskUsage / AccountedModel: attempt state and concrete model adapter
    - collect_task_usage: owns known charges and missing-usage flags for one execution
    - accounted_model: observes each concrete model request, including fallback attempts
    - current_task_usage: active attempt, or None outside task execution
    - Concrete requests delegate optional transcript capture to conversation_logging
"""
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from uuid import UUID, uuid4

from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import Model, ModelRequestParameters
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage, RunUsage

from conversation_logging import observe_request
from llm.model_prices import build_model_usage, reported_model_name
from schemas.model_usage import ModelUsage


@dataclass
class TaskUsage:
    """Known charges and uncertainty retained across failed calls in one execution."""

    attempt_id: UUID = field(default_factory=uuid4)
    entries: list[ModelUsage] = field(default_factory=list)
    incomplete: bool = False

    def record(self, model: str, usage: RequestUsage | RunUsage | None,
               provider_response_id: str | None = None) -> None:
        """Prices received usage; unknown prices or absent usage stay explicitly incomplete."""
        if usage is None or not (usage.input_tokens or usage.output_tokens):
            self.incomplete = True
            return
        if any(not isinstance(value, int) or value < 0 for value in (
            usage.input_tokens, usage.output_tokens, usage.cache_read_tokens, usage.cache_write_tokens,
        )):
            self.incomplete = True
            return
        entry = build_model_usage(model, usage)
        entry.provider_response_id = provider_response_id
        self.entries.append(entry)
        self.incomplete |= entry.cost_microdollars is None


_current: ContextVar[TaskUsage | None] = ContextVar("task_usage", default=None)


def current_task_usage() -> TaskUsage | None:
    """Returns this execution's accounting without leaking into later tasks."""
    return _current.get()


@contextmanager
def collect_task_usage(usage: TaskUsage | None = None) -> Iterator[TaskUsage]:
    """Keeps mutable accounting reachable after sync/async execution exits or raises."""
    usage = usage or TaskUsage()
    token = _current.set(usage)
    try:
        yield usage
    finally:
        _current.reset(token)


class AccountedModel(WrapperModel):
    """Observes actual provider requests before validation, limits or fallback can discard them."""

    async def request(
        self, messages: list[ModelMessage], model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        """Records each received response or flags a request whose usage never arrived."""
        usage = current_task_usage()
        # The pinned SDK retains total cache writes but loses their lifetime split.
        # Fix Luna to the priced 30-minute lifetime before issuing any request.
        if reported_model_name(self.wrapped.model_name, self.wrapped.model_id) == "openai:gpt-6-luna":
            model_settings = {**(model_settings or {}), "openai_service_tier": "default",
                              "openai_prompt_cache_options": {"mode": "implicit", "ttl": "30m"}}
        try:
            response = await observe_request(self.wrapped, messages, model_settings, model_request_parameters)
        except BaseException:
            if usage is not None:
                usage.incomplete = True
            raise
        if usage is not None:
            configured = self.wrapped.model_id
            usage.record(reported_model_name(response.model_name or configured, configured),
                         response.usage, response.provider_response_id)
        return response


def accounted_model(model: Model | str) -> Model | str:
    """Uses the existing model seam only while an execution is collecting costs."""
    return AccountedModel(model) if current_task_usage() is not None else model
