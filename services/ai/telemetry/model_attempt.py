"""Give concrete provider attempts readable names in generative traces.

Each request labels its configured role and model, including streamed requests.
These timing spans carry no prompt content, usage or cost totals.
"""

from contextlib import asynccontextmanager

import logfire
from pydantic_ai.models.wrapper import WrapperModel


class ModelAttempt(WrapperModel):
    """Label actual execution without changing provider selection or retry policy."""

    def __init__(self, model, *, role):
        super().__init__(model)
        self.role = role

    def _span(self):
        return logfire.span(
            f"{self.role.capitalize()} model attempt: {{model}}",
            model=self.wrapped.model_id,
            **{"model_attempt.role": self.role},
        )

    async def request(self, messages, model_settings, model_request_parameters):
        with self._span():
            return await self.wrapped.request(messages, model_settings, model_request_parameters)

    @asynccontextmanager
    async def request_stream(self, messages, model_settings, model_request_parameters, run_context=None):
        with self._span():
            async with self.wrapped.request_stream(
                messages, model_settings, model_request_parameters, run_context
            ) as response:
                yield response
