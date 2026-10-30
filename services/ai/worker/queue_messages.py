"""
Description: Pydantic models for the two SQS message formats shared with services/api.
Index:
    - TaskType: task types, mirroring AiTask::TASK_TYPES in Rails
    - AiTaskMessage: a task read from ai_tasks (published by AiTasks::EnqueueAiTaskService)
    - ModelUsage: tokens and known estimated cost of one provider response
    - AiResultMessage: a result written to ai_results (applied by AiTasks::ApplyAiResultService)
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from schemas.model_usage import ModelUsage
from schemas.screening_receipts import RecordScreening
from worker.legacy_career_context import normalize_legacy_career_context

TaskType = Literal[
    "check_job_preferences",
    "generate_summary",
    "rerank_job_listings",
    "improve_library_entry",
    "elicit_job_preferences",
    "review_library_section", "interview_session_feedback", "interview_clarification", "interview_references", "parse_resume", "scrape_job", "parse_job_posting", "analyze_gaps", "tailor_resume",
    "generate_study_guide", "generate_interview_questions", "regenerate_interview_question", "review_interview_answer",
]


class AiTaskMessage(BaseModel):
    """One unit of AI work requested by Rails."""

    ai_task_id: UUID
    user_id: UUID
    task_type: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


    @field_validator("input", mode="before")
    @classmethod
    def read_queued_legacy_context(cls, value):
        """Already-published queue bodies must match migrated Rails snapshots."""
        return normalize_legacy_career_context(value)


class AiResultMessage(BaseModel):
    """An outcome or usage-only report. Attempt identity deduplicates accounting, not execution."""

    ai_task_id: UUID
    status: Literal["completed", "needs_user_input", "failed", "usage"]
    result: dict[str, Any] | None = None
    pending_questions: list[dict[str, Any]] = Field(default_factory=list)
    message_history: list[dict[str, Any]] = Field(default_factory=list)
    error_message: str | None = None
    usage: list[ModelUsage] = Field(default_factory=list)
    attempt_id: UUID | None = None
    usage_incomplete: bool = False
    attempt_finished: bool = True
    record_screening: list[RecordScreening] = Field(default_factory=list)
