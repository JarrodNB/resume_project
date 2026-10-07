"""
Description: Pydantic models for the two SQS message formats shared with services/api.
Index:
    - TaskType: task types, mirroring AiTask::TASK_TYPES in Rails
    - AiTaskMessage: a task read from ai_tasks (published by AiTasks::EnqueueAiTaskService)
    - ModelUsage: tokens and estimated cost of one agent run, reported with a result
    - AiResultMessage: a result written to ai_results (applied by AiTasks::ApplyAiResultService)
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

TaskType = Literal["parse_resume", "scrape_job", "parse_job_posting", "analyze_gaps", "tailor_resume"]


class AiTaskMessage(BaseModel):
    """One unit of AI work requested by Rails."""

    ai_task_id: UUID
    user_id: UUID
    task_type: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


class ModelUsage(BaseModel):
    """Token counts and estimated cost of one agent run. `input_tokens` includes the cached
    ones."""

    model: str
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    cost_microdollars: int


class AiResultMessage(BaseModel):
    """The outcome of one task. Which optional fields are set depends on `status`."""

    ai_task_id: UUID
    status: Literal["completed", "needs_user_input", "failed"]
    result: dict[str, Any] | None = None
    pending_questions: list[dict[str, Any]] = Field(default_factory=list)
    message_history: list[dict[str, Any]] = Field(default_factory=list)
    error_message: str | None = None
    usage: list[ModelUsage] = Field(default_factory=list)
    # Set on tailor_resume results. ApplyAiResultService ignores a result whose generation is
    # not the task's current one, so a redelivered earlier section cannot rewind the draft.
    generation: int | None = None
