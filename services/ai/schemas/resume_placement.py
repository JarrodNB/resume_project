"""Typed suggestions for placing ambiguous resume bullets against existing roles."""

from pydantic import BaseModel, Field


class PlacementSuggestion(BaseModel):
    bullet_id: str
    role_id: str | None = None
    evidence_id: str | None = None


class ResumePlacement(BaseModel):
    suggestions: list[PlacementSuggestion] = Field(default_factory=list)
