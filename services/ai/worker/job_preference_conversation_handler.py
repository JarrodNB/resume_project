"""Screen only new preference text, resume owner-saved history and return editable proposals."""
import json

from pydantic_ai import DeferredToolRequests, DeferredToolResults
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    ToolReturnPart,
    UserPromptPart,
)

from agents.job_preference_conversation_agent import propose_job_preferences
from llm.model_prices import build_model_usage
from model_inputs.blocks import source_block
from privacy.contact_mask import mask_outbound
from schemas.job_preference_conversation import JobPreferenceConversationInput
from screening.prompt_guardrail import TOO_LONG_MESSAGE, screening_failure_message
from screening.screen_user_text import screen_user_text
from screening.session import (
    bind_screened_prompt,
    current_session,
    trust_generated_source,
    within_screening_session,
)
from worker.queue_messages import AiResultMessage


def cover_preference_history(history):
    """Restore exact coverage only for history from earlier accepted owner-resolved tasks."""
    session = current_session()
    for message in history:
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                    session.prompts.add(mask_outbound(part.content))
                elif isinstance(part, ToolReturnPart):
                    session.prompts.add(mask_outbound(json.dumps(part.content, ensure_ascii=False, default=str)))
    session.prompts.add(json.dumps("Final result processed."))


@within_screening_session
def handle_job_preference_conversation_task(task, dependencies):
    snapshot = JobPreferenceConversationInput.model_validate(task.input)
    if len(json.dumps(task.input, ensure_ascii=False).encode()) > 120_000:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=TOO_LONG_MESSAGE)
    usage = []

    def check(text):
        outcome = screen_user_text(mask_outbound(text), dependencies.settings.user_text_screen_model,
            dependencies.settings.llm_run_timeout_seconds, check_phrases=False)
        usage.extend(outcome.model_usages)
        return outcome

    def failure(outcome):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message=screening_failure_message(outcome))

    outcome = check(snapshot.message)
    if not outcome.allowed:
        return failure(outcome)
    current_session().allowed_sources.add(mask_outbound(snapshot.message))
    history = ModelMessagesTypeAdapter.validate_python(snapshot.history)
    if history:
        cover_preference_history(history)
    # The current draft may have been manually edited. Only exact server-marked generated
    # criteria can skip screening; a saved history never automatically approves a new draft.
    for criterion in snapshot.criteria:
        if criterion.text in snapshot.trusted_criteria:
            trust_generated_source(criterion.text)
        else:
            outcome = check(criterion.text)
            if not outcome.allowed:
                return failure(outcome)
            current_session().allowed_sources.add(mask_outbound(criterion.text))

    deferred = None
    if snapshot.question_id:
        answer = source_block("user_answer", snapshot.message)
        current_session().prompts.add(mask_outbound(json.dumps(answer, ensure_ascii=False)))
        deferred = DeferredToolResults(calls={snapshot.question_id: answer})
        prompt = None
    else:
        sources = [snapshot.message, *(item.text for item in snapshot.criteria)]
        def render(values):
            rows = ["New preference message:\n" + source_block("user_message", values[0])]
            rows.append("Current editable draft (not confirmed by this conversation):")
            for index, item in enumerate(snapshot.criteria):
                rows.append(f"Preference {index + 1}; priority: {item.priority}\n" + source_block("preference", values[index + 1]))
            return "\n\n".join(rows)
        prompt = bind_screened_prompt(sources, render)
    run = propose_job_preferences(prompt, history, deferred, dependencies.settings, allow_question=snapshot.turn < 12)
    usage.append(build_model_usage(run.model, run.usage))
    if len(json.dumps(run.history, ensure_ascii=False).encode()) > 100_000:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="This conversation is too long. Start a new conversation.")
    if isinstance(run.output, DeferredToolRequests):
        if len(run.output.calls) != 1 or run.output.approvals:
            raise ValueError("Ask one preference question at a time")
        call = run.output.calls[0]
        return AiResultMessage(ai_task_id=task.ai_task_id, status="needs_user_input", usage=usage,
            pending_questions=[{"id": call.tool_call_id, "question": call.args_as_dict()["question"]}], message_history=run.history)
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", usage=usage,
        result=run.output.model_dump(), message_history=run.history)
