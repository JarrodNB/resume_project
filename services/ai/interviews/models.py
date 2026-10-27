"""Admit and price each concrete interviewer or screening model request.

Accounting wraps the provider, below agent validation retries. Missing or unexpected
usage remains unknown, and transport retries are disabled in both provider clients.
Luna caching is explicitly disabled because the pinned usage mapper loses write-lifetime
details. Unsupported long-context or unexpected write usage cannot become a known bill.
"""

from contextlib import AsyncExitStack

import httpx
import httpx2
from openai import AsyncOpenAI
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.models.typesafe import TypeSafeModel
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.providers.typesafe import TypeSafeProvider
from typesafe_sdk import AsyncTypeSafeClient, RetryPolicy

from conversation_logging import observe_request
from interviews.audio_providers import ProviderError
from interviews.provider_calls import ProviderCalls
from interviews.provider_transport import provider_transport
from worker.model_prices import build_model_usage


class InterviewModel(WrapperModel):
    """One registered observation per actual model request, including invalid outputs."""

    def __init__(self, wrapped, rails, claim, stage, provider, model):
        super().__init__(wrapped)
        self.calls, self.claim = ProviderCalls(rails), claim
        self.stage, self.provider_name, self.configured = stage, provider, model

    async def request(self, messages, settings, model_request_parameters):
        known = False

        async def dispatch():
            nonlocal known
            output_cap = 4096 if self.claim.kind == "preparation" and self.stage == "interviewer" else 1024
            model_settings = {**(settings or {}), **({"max_tokens": output_cap} if self.provider_name == "openai" else {})}
            if self.provider_name == "openai":
                model_settings["openai_service_tier"] = "default"
            if self.configured == "gpt-6-luna":
                # Explicit mode without breakpoints makes no cache reads/writes. The pinned
                # Responses adapter forwards this option; Nano uses its older cache policy.
                model_settings["openai_prompt_cache_options"] = {"mode": "explicit"}
            response = await observe_request(self.wrapped, messages, model_settings, model_request_parameters)
            usage = response.usage
            # Never price an unknown model as the configured one or fabricate zero.
            entries = []
            if response.model_name in {self.configured, f"{self.provider_name}:{self.configured}"} and (
                usage.input_tokens > 0 or usage.output_tokens > 0
            ) and (self.configured != "gpt-6-luna" or (
                0 <= usage.cache_read_tokens <= usage.input_tokens <= 272_000 and
                usage.output_tokens >= 0 and usage.cache_write_tokens == 0
            )):
                priced = build_model_usage(f"{self.provider_name}:{self.configured}", usage)
                known = priced.cost_microdollars is not None
                if known:
                    entries = [priced.model_dump(exclude={"model", "cache_write_tokens"}, exclude_none=True)]
            return response, entries

        response = await self.calls.run(self.claim, self.stage, self.provider_name, self.configured, dispatch)
        if not known:
            raise ProviderError("unknown_provider_usage")
        return response


class InterviewModels:
    """Own clients for fixed approved models; construction requires both credentials."""

    def __init__(self, *, openai_key, typesafe_key, openai_transport=None, typesafe_transport=None):
        if not isinstance(openai_key, str) or not openai_key.strip() or not isinstance(typesafe_key, str) or not typesafe_key.strip():
            raise ValueError("Missing interview provider credentials")
        self._stack = AsyncExitStack()
        self.openai = AsyncOpenAI(api_key=openai_key, max_retries=0, base_url="https://api.openai.com/v1",
                                 http_client=httpx.AsyncClient(trust_env=False,
                                     transport=openai_transport or provider_transport(httpx.AsyncHTTPTransport), timeout=30))
        self.typesafe = AsyncTypeSafeClient(api_key=typesafe_key, retry=RetryPolicy(max_retries=0),
                                           base_url="https://api.typesafe.ai", timeout=3,
                                           http_client=httpx2.AsyncClient(trust_env=False,
                                               transport=typesafe_transport or provider_transport(httpx2.AsyncHTTPTransport), timeout=3))
        self.models = {
            "gpt-6-luna": OpenAIResponsesModel("gpt-6-luna", provider=OpenAIProvider(openai_client=self.openai)),
            "gpt-5-nano": OpenAIResponsesModel("gpt-5-nano", provider=OpenAIProvider(openai_client=self.openai)),
            "jev-1.13.0": TypeSafeModel("jev-1.13.0", provider=TypeSafeProvider(typesafe_client=self.typesafe)),
        }

    async def __aenter__(self):
        await self._stack.enter_async_context(self.openai)
        await self._stack.enter_async_context(self.typesafe)
        return self

    async def __aexit__(self, *exc):
        return await self._stack.__aexit__(*exc)

    def accounted(self, rails, claim, stage, model):
        provider = "typesafe" if model == "jev-1.13.0" else "openai"
        return InterviewModel(self.models[model], rails, claim, stage, provider, model)
