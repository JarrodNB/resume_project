"""Claim an AI-generated question from Rails before explaining it.

A duplicate delivery produces accounting only. Provider failures become visible failures;
an explicit request creates the bounded next attempt instead of silently regenerating.
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from agents.interview_clarification_agent import generate_interview_clarification
from database.interview_auxiliary import build_interview_auxiliary_reader
from llm.model_prices import build_model_usage, reported_model_name
from model_inputs.blocks import source_block
from screening.session import bind_screened_prompt, screening_session, trust_generated_source
from worker.queue_messages import AiResultMessage


class ClarificationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clarification_id: UUID
    message_id: UUID | None = None
    question_digest: str | None = None
    question_text: str | None = Field(default=None, max_length=4000)


def handle_interview_clarification_task(task, dependencies):
    """Rails owns admission; the reader verifies its claimed task before loading the prompt."""
    ClarificationInput.model_validate(task.input)
    settings = dependencies.settings
    if not settings.interview_service_secret.strip():
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="failed",
            error_message="Question clarification is not configured",
        )
    response = dependencies.http_client.post(
        settings.interview_rails_origin.rstrip("/")
        + f"/internal/interviews/clarifications/{task.ai_task_id}/claim",
        headers={"Authorization": f"Bearer {settings.interview_service_secret}"},
        timeout=10,
    )
    response.raise_for_status()
    grant = response.json()
    if not grant.get("allowed"):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="usage")
    reader = dependencies.read_interview_auxiliary or build_interview_auxiliary_reader(settings)
    try:
        saved = reader(task, grant)
    except (ValueError, KeyError):
        return AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message="Question changed"
        )
    question = saved["question_text"]
    with screening_session(min(settings.llm_run_timeout_seconds, 30)):
        # Rails confirms this is the current AI-generated interview question.
        trust_generated_source(question)
        prompt = bind_screened_prompt(
            [question], lambda values: source_block("interview_question", values[0])
        )
        run = generate_interview_clarification(prompt, settings)
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="completed",
            result=run.output.model_dump(),
            usage=[
                build_model_usage(
                    reported_model_name(
                        run.response.model_name or settings.interview_questions_model,
                        settings.interview_questions_model,
                    ),
                    run.usage,
                )
            ],
        )
