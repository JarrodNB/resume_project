"""Account for every concrete chat provider request, including streamed requests.

The same Rails attempt records and model prices account for classifiers, replies and
later summaries. Provider retries are disabled; cancellation leaves usage unknown.
"""
from contextlib import asynccontextmanager
from uuid import uuid4

from pydantic_ai.models.wrapper import WrapperModel

from conversation_logging import observe_request
from interviews.models import InterviewModels
from llm.model_prices import build_model_usage


class ChatModel(WrapperModel):
    def __init__(self, wrapped, rails, claim, stage, provider, configured):
        super().__init__(wrapped)
        self.rails, self.claim, self.stage = rails, claim, stage
        self.provider_name, self.configured = provider, configured

    def request_settings(self, settings):
        settings = dict(settings or {})
        if self.provider_name == "openai":
            settings.update(openai_service_tier="default", max_tokens=2400)
            if self.configured == "gpt-6-luna":
                settings["openai_prompt_cache_options"] = {"mode": "explicit"}
        return settings

    def _entries(self, response, complete):
        usage = response.usage
        if not complete or response.model_name not in {
            self.configured, f"{self.provider_name}:{self.configured}"
        } or not (usage.input_tokens or usage.output_tokens):
            return []
        priced = build_model_usage(f"{self.provider_name}:{self.configured}", usage)
        if priced.cost_microdollars is None or usage.cache_write_tokens:
            return []
        return [priced.model_dump(exclude={"model", "cache_write_tokens"}, exclude_none=True)]

    async def _start(self):
        identity = str(uuid4())
        await self.rails.start_provider(self.claim, identity, self.stage, self.provider_name, self.configured)
        return identity

    async def request(self, messages, settings, model_request_parameters):
        observation = await self._start()
        entries = []
        try:
            response = await observe_request(self.wrapped, messages, self.request_settings(settings), model_request_parameters)
            entries = self._entries(response, True)
            return response
        finally:
            await self.rails.usage(self.claim, entries, incomplete=not bool(entries), observation_id=observation)

    @asynccontextmanager
    async def request_stream(self, messages, settings, model_request_parameters, run_context=None):
        observation = await self._start()
        entries = []
        try:
            async with self.wrapped.request_stream(
                messages, self.request_settings(settings), model_request_parameters, run_context
            ) as response:
                try:
                    yield response
                finally:
                    # Validation/cancellation after EOF must not discard a received bill.
                    final = response.get()
                    entries = self._entries(final, final.state == "complete")
        finally:
            await self.rails.usage(self.claim, entries, incomplete=not bool(entries), observation_id=observation)


class ChatModels(InterviewModels):
    """Reuse the existing fixed provider clients, with a stream-aware accounting adapter."""

    def accounted(self, rails, claim, stage, model):
        model = model.removeprefix("openai:").removeprefix("typesafe:")
        provider = "typesafe" if model == "jev-1.13.0" else "openai"
        return ChatModel(self.models[model], rails, claim, stage, provider, model)
