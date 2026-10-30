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

from pydantic_ai.exceptions import UsageLimitExceeded
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


@dataclass
class ModelRequestBudget:
    """An optional feature-wide cap shared by primary, fallback and validation requests."""

    request_limit: int
    token_limit: int
    requests: int = 0
    tokens: int = 0

    def before_request(self):
        if self.requests >= self.request_limit or self.tokens >= self.token_limit:
            raise UsageLimitExceeded("This task exceeded its shared model-call or token budget.")
        self.requests += 1

    def record_response(self, usage):
        self.tokens += usage.input_tokens + usage.output_tokens
        if self.tokens > self.token_limit:
            raise UsageLimitExceeded("This task exceeded its shared token budget.")


_request_budget: ContextVar[ModelRequestBudget | None] = ContextVar("model_request_budget", default=None)


@contextmanager
def model_request_budget(*, request_limit: int, token_limit: int):
    """Cap actual calls across multiple agent runs without changing existing unscoped runs."""
    budget = ModelRequestBudget(request_limit=request_limit, token_limit=token_limit)
    token = _request_budget.set(budget)
    try:
        yield budget
    finally:
        _request_budget.reset(token)


class AccountedModel(WrapperModel):
    """Observes actual provider requests before validation, limits or fallback can discard them."""

    async def request(
        self, messages: list[ModelMessage], model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        """Records each received response or flags a request whose usage never arrived."""
        usage = current_task_usage()
        budget = _request_budget.get()
        if budget is not None:
            budget.before_request()
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
        if budget is not None:
            budget.record_response(response.usage)
        return response


def accounted_model(model: Model | str) -> Model | str:
    """Uses the existing model seam only while an execution is collecting costs."""
    return AccountedModel(model) if current_task_usage() is not None or _request_budget.get() is not None else model
