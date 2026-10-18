"""Bounded successful-check metadata shared with Rails; never includes source text."""

from pydantic import BaseModel, ConfigDict, Field


class ScreeningSuccess(BaseModel):
    """Exact protected-content and policy SHA-256 fingerprints for the task owner."""

    model_config = ConfigDict(extra="forbid", strict=True)

    content_digest: str = Field(pattern=r"^[0-9a-f]{64}$", min_length=64, max_length=64)
    policy_identity: str = Field(pattern=r"^[0-9a-f]{64}$", min_length=64, max_length=64)
