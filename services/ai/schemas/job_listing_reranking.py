"""Bound selected IDs and locally loaded excerpts for optional job-board reranking.

Only candidate identities and text are accepted; no career facts are supplied by
the browser. Output contains an ordering, never a fit score or generated claims.
"""

import json
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ListingExcerpt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    text: str = Field(min_length=1)

    @field_validator("text")
    @classmethod
    def bounded_text(cls, value: str) -> str:
        if not value.strip() or len(value.encode("utf-8")) > 6000:
            raise ValueError("Listing text must be nonblank and at most 6000 bytes")
        return value


class RerankListingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    keyword: str = Field(min_length=1, max_length=200)
    listings: list[ListingExcerpt] = Field(min_length=1, max_length=100)

    @field_validator("keyword")
    @classmethod
    def nonblank_keyword(cls, value: str) -> str:
        if not value.strip() or any(ord(char) < 32 for char in value):
            raise ValueError("Search keyword must be nonblank and have no control characters")
        return value.strip()

    @model_validator(mode="after")
    def bounded_excerpts(self):
        ids = [item.id for item in self.listings]
        if len(ids) != len(set(ids)):
            raise ValueError("Listing IDs must be unique")
        if (
            len(json.dumps(self.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            > 200000
        ):
            raise ValueError("Reranking snapshot is too large")
        return self


class RerankListingsCommand(BaseModel):
    """Durable selection without copied catalogue fields."""
    model_config = ConfigDict(extra="forbid")
    keyword: str = Field(min_length=1, max_length=200)
    listing_ids: list[UUID] = Field(min_length=1, max_length=100)

    _keyword = field_validator("keyword")(RerankListingsInput.nonblank_keyword.__func__)

    @field_validator("listing_ids")
    @classmethod
    def unique_ids(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Listing IDs must be unique")
        return value


class RankedListings(BaseModel):
    ranked_listing_ids: list[UUID] = Field(min_length=1, max_length=100)
