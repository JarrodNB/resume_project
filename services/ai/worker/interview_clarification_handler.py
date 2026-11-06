"""Explain an AI-generated question after interview-help coordination admits the attempt.

Only the canonical saved question reaches the explanation model. Claim handling and
explicit-retry policy live in interview_help; this module owns prompting and model usage.
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from agents.interview_clarification_agent import generate_interview_clarification
from model_inputs.blocks import source_block
from screening.session import bind_screened_prompt, screening_session, trust_generated_source
from worker.queue_messages import AiResultMessage


class ClarificationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clarification_id: UUID
    message_id: UUID | None = None
    question_digest: str | None = None
    question_text: str | None = Field(default=None, max_length=4000)


def explain_claimed_question(task, dependencies, saved):
    """Perform feature work only after a claim and owned context read succeed."""
    settings = dependencies.settings
    question = saved["question_text"]
    with screening_session(min(settings.llm_run_timeout_seconds, 30)):
        # Rails confirms this is the current AI-generated interview question.
        trust_generated_source(question)
        prompt = bind_screened_prompt(
            [question], lambda values: source_block("interview_question", values[0])
        )
        clarification = generate_interview_clarification(prompt, settings)
        return AiResultMessage(
            ai_task_id=task.ai_task_id,
            status="completed",
            result=clarification.model_dump(),
        )
