"""Reserve logical extraction calls before awaiting providers across chunk runs.

Fallback and physical request accounting remain in the existing generative adapter.
Token limits use completed responses, so already in-flight calls may finish together.
"""

from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.usage import RunUsage


class ImportBudgetModel(WrapperModel):
    """Share the configured extraction caps without counting screening calls."""

    def __init__(self, wrapped, limits):
        super().__init__(wrapped)
        self.limits = limits
        self.usage = RunUsage()

    async def request(self, messages, model_settings, model_request_parameters):
        self.limits.check_before_request(self.usage)
        self.usage.requests += 1
        response = await self.wrapped.request(messages, model_settings, model_request_parameters)
        self.usage.incr(response.usage)
        self.limits.check_tokens(self.usage)
        return response
