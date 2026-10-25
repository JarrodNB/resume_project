"""Prepare one editing turn: screen new user text, reuse owned saved history, and never
classify our generated questions or proposals. Rails keeps that history private and immutable.
"""

import json

from pydantic_ai import DeferredToolRequests, DeferredToolResults
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    ToolReturnPart,
    UserPromptPart,
)

from agents.library_edit_agent import LibraryEditDeps, improve_library_entry
from schemas.library_edit import LibraryEditInput
from screening.library_fields import screen_library_fields
from screening.prompt_guardrail import BLOCKED_MESSAGE, TOO_LONG_MESSAGE, UNCHECKED_MESSAGE
from screening.screen_user_text import screen_user_text
from screening.session import (
    bind_screened_prompt,
    current_session,
    trust_generated_source,
    within_screening_session,
)
from worker.contact_mask import mask_outbound
from worker.library_review_handler import render_review
from worker.model_prices import build_model_usage
from worker.queue_messages import AiResultMessage

SKIP_NOTE = "The user skipped this question. Do not invent the missing fact or ask it again; propose wording from known facts."
DEFAULT_FEEDBACK = "Improve clarity and specificity while preserving the available facts."


def cover_saved_history(history):
    """Restore exact coverage earned by an earlier owned successful/paused edit.

    Rails never accepts history from the browser. Earlier user parts were screened before
    those runs; generated tool returns and questions must not go back to a classifier.
    Unknown additions still pass through the ordinary guard. This is feature-local coverage.
    """
    session = current_session()
    for message in history:
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                    session.prompts.add(mask_outbound(part.content))
                elif isinstance(part, ToolReturnPart):
                    session.prompts.add(mask_outbound(json.dumps(part.content, ensure_ascii=False, default=str)))
    # Pydantic AI may append this application-owned output-tool acknowledgement
    # when a completed proposal is followed by another feedback turn.
    session.prompts.add(json.dumps("Final result processed."))


@within_screening_session
def handle_library_edit_task(task, dependencies):
    snapshot = LibraryEditInput.model_validate(task.input)
    if len(json.dumps(task.input, ensure_ascii=False).encode()) > 180_000:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=TOO_LONG_MESSAGE)
    usage = []

    def check(text):
        outcome = screen_user_text(mask_outbound(text), dependencies.settings.user_text_screen_model,
                                   dependencies.settings.llm_run_timeout_seconds, check_phrases=False)
        usage.extend(outcome.model_usages)
        return outcome

    def failure(outcome):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                               error_message=TOO_LONG_MESSAGE if outcome.too_long else UNCHECKED_MESSAGE if outcome.unchecked else BLOCKED_MESSAGE)

    history = ModelMessagesTypeAdapter.validate_python(snapshot.history)
    if history and not snapshot.previous_task_id:
        raise ValueError("Saved editing history requires an owned previous task")
    if snapshot.feedback:
        outcome = check(snapshot.feedback)
        if not outcome.allowed:
            return failure(outcome)
        current_session().allowed_sources.add(mask_outbound(snapshot.feedback))
    feedback = snapshot.feedback or (SKIP_NOTE if snapshot.skip else DEFAULT_FEEDBACK)
    if not snapshot.feedback:
        trust_generated_source(feedback)

    deferred = None
    if history:
        cover_saved_history(history)
        if snapshot.question_id:
            answer = SKIP_NOTE if snapshot.skip else feedback
            # Only this newest user answer was checked above; the exact serialized
            # tool return receives coverage, not arbitrary history supplied by a caller.
            current_session().prompts.add(mask_outbound(json.dumps(answer, ensure_ascii=False)))
            deferred = DeferredToolResults(calls={snapshot.question_id: answer})
            prompt = None
        else:
            prompt = bind_screened_prompt([feedback], lambda values: "User feedback:\n" + values[0])
    else:
        source = snapshot.library.model_dump_json(exclude_none=True)
        outcome = screen_library_fields(snapshot.library, check)
        if outcome is not True and not outcome.allowed:
            return failure(outcome)
        label = snapshot.target.label
        prompt = bind_screened_prompt([source, feedback], lambda values:
            render_review(values[0]) + f"\n\nImprove only target {label}.\nUser feedback:\n" + values[1])
    deps = LibraryEditDeps(1000 if snapshot.target.kind == "experience_highlight" else 4000,
                           allow_question=not snapshot.skip and snapshot.turn < 8)
    run = improve_library_entry(prompt, history, deferred, deps, dependencies.settings)
    result_usage = [*usage, build_model_usage(run.model, run.usage)]
    if len(json.dumps(run.history, ensure_ascii=False).encode()) > 100_000:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=result_usage,
                               error_message="This editing exchange is too long. Start a new edit.")
    if isinstance(run.output, DeferredToolRequests):
        if len(run.output.calls) != 1 or run.output.approvals:
            raise ValueError("Ask one question at a time")
        call = run.output.calls[0]
        return AiResultMessage(ai_task_id=task.ai_task_id, status="needs_user_input", usage=result_usage,
            pending_questions=[{"id": call.tool_call_id, "question": call.args_as_dict()["question"]}], message_history=run.history)
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result=run.output.model_dump(),
                           message_history=run.history, usage=result_usage)
