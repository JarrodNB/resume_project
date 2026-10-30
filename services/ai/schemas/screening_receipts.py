"""Exact typed-value receipts shared by queue and interactive saved-record workflows."""

from pydantic import BaseModel, Field


class RecordScreening(BaseModel):
    """Fields of one saved record checked in this execution, by typed-value fingerprint.

    `revision` holds version counters that must still match, such as an interview
    question's `question_revision` and `answer_revision`.
    """

    record_type: str
    record_id: str
    fingerprints: dict[str, str] = Field(max_length=16)
    revision: dict[str, int] = Field(default_factory=dict)
