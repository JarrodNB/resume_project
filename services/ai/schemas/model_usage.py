"""Provider usage and estimated costs shared by every AI execution transport."""

from pydantic import BaseModel, Field


class ModelUsage(BaseModel):
    """One response's token counts and estimated cost; None means its price is unknown.
    `input_tokens` includes cached tokens."""

    model: str
    input_tokens: int = Field(ge=0)
    cached_input_tokens: int = Field(ge=0)
    cache_write_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(ge=0)
    cost_microdollars: int | None = Field(default=None, ge=0)
    provider_response_id: str | None = None
