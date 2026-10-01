"""
Description: Pydantic models for the two SQS message formats shared with services/api.
Index:
    - TaskType: task types, mirroring AiTask::TASK_TYPES in Rails
    - AiTaskMessage: a task read from ai_tasks (published by AiTasks::EnqueueAiTaskService)
    - AiResultMessage: a result written to ai_results (applied by AiTasks::ApplyAiResultService)
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

TaskType = Literal["parse_resume", "scrape_job", "analyze_gaps", "tailor_resume"]


class AiTaskMessage(BaseModel):
    """One unit of AI work requested by Rails."""

    ai_task_id: UUID
    user_id: UUID
    task_type: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


class AiResultMessage(BaseModel):
    """The outcome of one task. Which optional fields are set depends on `status`."""

    ai_task_id: UUID
    status: Literal["completed", "needs_user_input", "failed"]
    result: dict[str, Any] | None = None
    pending_questions: list[dict[str, Any]] = Field(default_factory=list)
    message_history: list[dict[str, Any]] = Field(default_factory=list)
    error_message: str | None = None
