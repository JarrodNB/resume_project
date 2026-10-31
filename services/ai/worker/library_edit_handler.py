"""Prepare one edit from owned sources, canonical commands and per-turn generated state.

Only new generated fragments return to Rails. Earlier user prompts and deferred answers
are rebuilt from the bounded owned command chain, never copied into result history.
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
from database.library_edit_reader import build_database_edit_reader
from llm.model_prices import build_model_usage
from model_inputs.blocks import source_block
from privacy.contact_mask import mask_outbound
from screening.prompt_guardrail import TOO_LONG_MESSAGE, screening_failure_message
from screening.record_adapters import library_records
from screening.records import record_failure_message, screen_records_sync
from screening.screen_user_text import screen_user_text
from screening.session import (
    approve_projected_source,
    bind_screened_prompt,
    current_session,
    trust_generated_source,
    within_screening_session,
)
from worker.library_review_handler import render_review
from worker.queue_messages import AiResultMessage

SKIP_NOTE = "The user skipped this question. Do not invent the missing fact or ask it again; propose wording from known facts."
DEFAULT_FEEDBACK = "Improve clarity and specificity while preserving the available facts."


def render_initial_edit(source, feedback, label, review):
    """Rebuild the initial readable context only from the current owned DB projection."""
    rows = [source, f"Improve only target {label}."]
    if review and review.answers:
        for item in review.answers:
            number = item.question_index + 1
            rows.extend([f"Review question {number} (generated guidance, not a statement of fact):\n" + source_block("review_question", item.question),
                         f"User answer {number}:\n" + source_block("user_answer", item.answer)])
        rows.extend(["Additional editing guidance:\n" + source_block("user_feedback", feedback),
                     ("Further questions are disabled. Use all answered facts to generate one proposal. "
                      "Unanswered questions supply no facts; do not invent answers or append disclaimers about absent details. Preserve explicitly supplied qualifications.")])
    elif review:
        rows.extend(["Review question (generated guidance, not a statement of fact):\n" + source_block("review_question", review.question),
                     "User answer:\n" + source_block("user_answer", feedback),
                     ("Further questions are disabled. Generate a proposal from known facts and this answer."
                      " Preserve explicitly supplied qualifications; do not add disclaimers about absent details.")])
    else:
        rows.append("User feedback:\n" + source_block("user_feedback", feedback))
    return "\n\n".join(rows)


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
    reader = dependencies.read_library_edit or build_database_edit_reader(dependencies.settings)
    try:
        snapshot = reader(task)
    except ValueError:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
                               error_message="This editing source changed or is unavailable. Start a new edit.")
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
                               error_message=screening_failure_message(outcome))

    # Rendering consumes selected typed fields directly; JSON is used only for wire
    # fragments and exact tool-return coverage, never as the model's career prompt.
    source = render_review(snapshot.library)
    restored = []
    for turn in snapshot.turns:
        feedback = turn.feedback or (SKIP_NOTE if turn.skip else DEFAULT_FEEDBACK)
        if not restored:
            request = {"kind": "request", "parts": [{"part_kind": "user-prompt", "content":
                render_initial_edit(source, feedback, snapshot.target.label, snapshot.review_question)}]}
        elif turn.question_id:
            request = {"kind": "request", "parts": [{"part_kind": "tool-return", "tool_name": "ask_user",
                "tool_call_id": turn.question_id, "content": source_block("user_answer", feedback)}]}
        else:
            request = {"kind": "request", "parts": [{"part_kind": "user-prompt", "content":
                "User feedback:\n" + source_block("user_feedback", feedback)}]}
        fragment = turn.history
        # An output-tool acknowledgement must precede new feedback in the same
        # request, exactly as Pydantic AI emitted it during that successful turn.
        if fragment and fragment[0].get("kind") == "request":
            restored.append({"kind": "request", "parts": fragment[0]["parts"] + request["parts"]})
            restored.extend(fragment[1:])
        else:
            restored.extend([request, *fragment])
    history = ModelMessagesTypeAdapter.validate_python(restored)
    if history and not snapshot.previous_task_id:
        raise ValueError("Saved editing history requires an owned previous task")
    prior_generated = [message for turn in snapshot.turns for message in turn.history]
    if len(json.dumps(prior_generated, ensure_ascii=False).encode()) > 100_000:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=TOO_LONG_MESSAGE)
    if snapshot.feedback:
        outcome = check(snapshot.feedback)
        if not outcome.allowed:
            return failure(outcome)
        approve_projected_source(snapshot.feedback, snapshot.feedback, lambda value: value, outcome)
    feedback = snapshot.feedback or (SKIP_NOTE if snapshot.skip else DEFAULT_FEEDBACK)
    if not snapshot.feedback:
        trust_generated_source(feedback)

    deferred = None
    if history:
        cover_saved_history(history)
        if snapshot.question_id:
            answer = source_block("user_answer", SKIP_NOTE if snapshot.skip else feedback)
            # Only this newest user answer was checked above; the exact serialized
            # tool return receives coverage, not arbitrary history supplied by a caller.
            current_session().prompts.add(mask_outbound(json.dumps(answer, ensure_ascii=False)))
            deferred = DeferredToolResults(calls={snapshot.question_id: answer})
            prompt = None
        else:
            prompt = bind_screened_prompt([feedback], lambda values: "User feedback:\n" + source_block("user_feedback", values[0]))
    else:
        # Rails approves receipts only when admission fingerprints and current fields match.
        if records := library_records(snapshot.library):
            outcome = screen_records_sync(records, approved_sources=[source])
            usage.extend(outcome.decision.model_usages)
            if not outcome.allowed:
                return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                                       error_message=record_failure_message(outcome))
        sources = [source, feedback]
        if snapshot.review_question and snapshot.review_question.answers:
            for item in snapshot.review_question.answers:
                outcome = check(item.answer)
                if not outcome.allowed:
                    return failure(outcome)
                approve_projected_source(item.answer, item.answer, lambda value: value, outcome)
                trust_generated_source(item.question)
                sources.extend([item.question, item.answer])
        elif snapshot.review_question:
            trust_generated_source(snapshot.review_question.question)
            sources.append(snapshot.review_question.question)
        prompt = bind_screened_prompt(sources, lambda _values: render_initial_edit(
            source, feedback, snapshot.target.label, snapshot.review_question))
    deps = LibraryEditDeps(1000 if snapshot.target.kind == "experience_highlight" else 4000,
                           allow_question=snapshot.review_question is None and not snapshot.skip and snapshot.turn < 8)
    run = improve_library_entry(prompt, history, deferred, deps, dependencies.settings)
    result_usage = [*usage, build_model_usage(run.model, run.usage)]
    saved_history = run.history
    if len(json.dumps([*prior_generated, *saved_history], ensure_ascii=False).encode()) > 100_000:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=result_usage,
                               error_message="This editing exchange is too long. Start a new edit.")
    if isinstance(run.output, DeferredToolRequests):
        if len(run.output.calls) != 1 or run.output.approvals:
            raise ValueError("Ask one question at a time")
        call = run.output.calls[0]
        return AiResultMessage(ai_task_id=task.ai_task_id, status="needs_user_input", usage=result_usage,
            pending_questions=[{"id": call.tool_call_id, "question": call.args_as_dict()["question"]}], message_history=saved_history)
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result=run.output.model_dump(),
                           message_history=saved_history, usage=result_usage)
