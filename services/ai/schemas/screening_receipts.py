"""Exact saved-source screening receipts returned to Rails by AI executions."""

from pydantic import BaseModel, Field


class LibraryScreening(BaseModel):
    """Successful field checks to add to a saved record owned by the task user."""

    record_type: str
    record_id: str
    fields: list[str] = Field(max_length=16)
    fingerprints: dict[str, str] = Field(default_factory=dict, max_length=16)


class JobScreening(BaseModel):
    """Checked saved-job fields mapped to canonical typed-value SHA-256 fingerprints."""

    job_id: str
    fields: dict[str, str]


class GapResponseScreening(BaseModel):
    """Checked answer fields mapped to exact typed-value fingerprints."""

    response_id: str
    fields: dict[str, str]


class InterviewQuestionScreening(BaseModel):
    """Exact practice fields checked at their queued question/answer revisions."""

    question_id: str
    question_revision: int
    answer_revision: int | None = None
    fields: dict[str, str]


class RecordScreening(BaseModel):
    """Fields of one saved record checked in this execution, by typed-value fingerprint.

    `revision` holds version counters that must still match, such as an interview
    question's `question_revision` and `answer_revision`.
    """

    record_type: str
    record_id: str
    fingerprints: dict[str, str] = Field(max_length=16)
    revision: dict[str, int] = Field(default_factory=dict)
