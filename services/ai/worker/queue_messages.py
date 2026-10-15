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
    "parse_resume", "scrape_job", "parse_job_posting", "analyze_gaps", "tailor_resume",
    "generate_interview_questions", "regenerate_interview_question", "review_interview_answer",
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
    # Set on tailor_resume results. ApplyAiResultService ignores a result whose generation is
    # not the task's current one, so a redelivered earlier section cannot rewind the draft.
    generation: int | None = None
