"""Whole Markdown drafts and separate editorial opinions, without evidence validators."""

from pydantic import BaseModel, Field


class ResumeDocumentDraft(BaseModel):
    markdown: str = Field(min_length=1, max_length=100_000)
    sufficient_for_target: bool
    sufficiency_explanation: str


class ResumeEditorialReview(BaseModel):
    ready: bool
    feedback: str
    sufficient_for_target: bool
    sufficiency_explanation: str
