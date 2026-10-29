"""Private frozen preference-check inputs; IDs and exact passages come from Rails."""
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class FrozenPreference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    text: str = Field(min_length=1, max_length=500)
    priority: Literal["must_have", "nice_to_have"]
    trusted_generated: bool = False
    screened: bool = False


class PreferencePassage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^P[1-9][0-9]{0,2}$")
    text: str = Field(min_length=1, max_length=500)


class PreferenceListing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    source_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    truncated: bool
    screened: bool = False
    passages: list[PreferencePassage] = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def unique_passages(self):
        if len({p.id for p in self.passages}) != len(self.passages):
            raise ValueError("Repeated source passage")
        if sum(len(p.text.encode("utf-8")) for p in self.passages) > 8_000:
            raise ValueError("Source excerpt is too large")
        return self


class PreferenceCheckInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: UUID
    confirmed_revision: int = Field(ge=1)
    criteria: list[FrozenPreference] = Field(min_length=1, max_length=10)
    listings: list[PreferenceListing] = Field(min_length=1, max_length=1)

    @field_validator("criteria")
    @classmethod
    def unique_criteria(cls, value):
        if len({c.id for c in value}) != len(value):
            raise ValueError("Repeated preference")
        return value
