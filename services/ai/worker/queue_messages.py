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

from pydantic import BaseModel, Field

TaskType = Literal[
    "rerank_job_listings",
    "improve_library_entry",
    "review_library_section", "interview_clarification", "interview_references", "parse_resume", "scrape_job", "parse_job_posting", "analyze_gaps", "tailor_resume",
    "generate_study_guide", "generate_interview_questions", "regenerate_interview_question", "review_interview_answer",
]


class AiTaskMessage(BaseModel):
    """One unit of AI work requested by Rails."""

    ai_task_id: UUID
    user_id: UUID
    task_type: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


class ModelUsage(BaseModel):
    """One response's token counts and estimated cost; None means its price is unknown.
    `input_tokens` includes cached tokens."""

    model: str
    input_tokens: int = Field(ge=0)
    cached_input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cost_microdollars: int | None = Field(default=None, ge=0)


class LibraryScreening(BaseModel):
    """Successful field checks to add to a saved record owned by the task user."""

    record_type: str
    record_id: str
    fields: list[str]


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
    library_screening: list[LibraryScreening] = Field(default_factory=list)
    job_screening: list[JobScreening] = Field(default_factory=list)
    gap_response_screening: list[GapResponseScreening] = Field(default_factory=list)
    interview_question_screening: list[InterviewQuestionScreening] = Field(default_factory=list)
