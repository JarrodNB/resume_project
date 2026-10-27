"""Capture local task transcripts independently of provider accounting.

Record masked model exchanges and delivery outcomes in one file per AI task.
Logging failures must never change task results or replace provider errors.
"""
import fcntl
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from pydantic import ValidationError
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.exceptions import ModelRetry, ToolRetryError, UnexpectedModelBehavior
from pydantic_ai.messages import ModelRequest, RetryPromptPart
from pydantic_ai.models.wrapper import WrapperModel

from conversation_logging.render import render_instructions, render_messages

logger = logging.getLogger(__name__)


@dataclass
class _RunObservation:
    run_id: str | None
    request_id: UUID | None = None
    model: str | None = None
    provider_error: BaseException | None = None
    seen: set[int] = field(default_factory=set)


_run = ContextVar("conversation_run", default=None)
_fallback = ContextVar("conversation_fallback", default=None)


class ConversationLogging(AbstractCapability):
    """Observe new validation feedback at node boundaries, including terminal rejection.

    Per-run context isolates nested/concurrent agents. Initial history is retained in
    snapshots, but never announced as newly observed failures.
    """

    async def wrap_run(self, ctx, *, handler):
        """Restore parent observation state after success, failure or cancellation."""
        if _current.get() is None:
            return await handler()
        try:
            state = _RunObservation(ctx.run_id, seen={id(part) for message in ctx.messages for part in message.parts})
        except Exception:  # noqa: BLE001 - failed observation must still execute the agent
            logger.warning("Conversation run could not be initialized")
            state = None
        token = _run.set(state)
        fallback = _fallback.get()
        fallback_token = _fallback.set(
            (fallback[0], ctx.run_id) if fallback and fallback[1] is None else None
        )
        try:
            return await handler()
        finally:
            _fallback.reset(fallback_token)
            _run.reset(token)

    async def wrap_node_run(self, ctx, *, node, handler):
        """Observe feedback only after execution, without recovering execution errors."""
        try:
            result = await handler(node)
        except UnexpectedModelBehavior as error:
            _observe_exhaustion(error)
            raise
        else:
            _observe_feedback(ctx.messages)
            return result


def _observe_exhaustion(error):
    """Read only explicit validation causes; unrelated run errors have no such event."""
    try:
        state = _run.get()
        if state is None or error is state.provider_error:
            return
        cause = error.__cause__
        if isinstance(cause, ToolRetryError):
            _validation_event(cause.tool_retry, exhausted=True)
        elif isinstance(cause, ValidationError):
            _validation_event(RetryPromptPart(cause.errors(include_url=False)), exhausted=True)
        elif isinstance(cause, ModelRetry):
            _validation_event(RetryPromptPart(cause.message), exhausted=True)
    except Exception:  # noqa: BLE001 - preserve the original execution error
        logger.warning("Conversation validation exhaustion could not be observed")


def _observe_feedback(messages):
    """Announce newly appended retry parts once, retaining full snapshot histories."""
    try:
        state = _run.get()
        if state is not None:
            for message in messages:
                if isinstance(message, ModelRequest):
                    for part in message.parts:
                        if isinstance(part, RetryPromptPart) and id(part) not in state.seen:
                            state.seen.add(id(part))
                            _validation_event(part)
    except Exception:  # noqa: BLE001 - preserve a completed node's result
        logger.warning("Conversation validation feedback could not be observed")


def _validation_event(part, *, exhausted=False):
    """Render only available masked retry feedback, preserving the original outcome."""
    try:
        transcript, state = _current.get(), _run.get()
        if transcript is None or state is None:
            return
        # Validation runs after response restoration; mask again at this capture boundary.
        from pydantic_ai.models import ModelRequestParameters

        from privacy.contact_mask import mask_outbound
        feedback = mask_outbound(render_messages([ModelRequest(parts=[part])], ModelRequestParameters()))
        label = "VALIDATION EXHAUSTED" if exhausted else "VALIDATION FAILURE / RETRY"
        transcript.append(f"### {label} — Attempt {transcript.attempt} — {_timestamp()}\n\n"
                          f"Run: {state.run_id}\nRequest: {state.request_id}\nModel: {state.model}\n\n" + feedback)
    except Exception:  # noqa: BLE001 - observation cannot replace a validation result/error
        logger.warning("Conversation validation event could not be rendered")


@dataclass
class Transcript:
    """One execution's transcript destination and identity."""
    path: Path
    attempt: UUID

    def append(self, text):
        """Appends one block without allowing filesystem failure to affect work."""
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as stream:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
                stream.write(text + "\n\n")
                stream.flush()
        except Exception:  # noqa: BLE001 - transcript failures must never affect task execution
            logger.warning("Conversation transcript could not be written")


_current = ContextVar("conversation_transcript", default=None)


def _timestamp():
    """Returns readable UTC time for each observed block."""
    return datetime.now(UTC).isoformat()


@contextmanager
def conversation_scope(task, settings, attempt_id, receive_count):
    """Enables capture solely in explicit local worker execution, with an opt-out."""
    transcript = None
    if settings.worker_environment == "local" and settings.conversation_logging_enabled:
        try:
            transcript = Transcript(Path("conversation_logs") / str(task.user_id) / f"task-{task.ai_task_id}.md", attempt_id)
            label = "INITIAL ATTEMPT" if receive_count == 1 else "RETRY / REDELIVERY"
            transcript.append(f"## {label} — delivery {receive_count} — {_timestamp()}\n\n"
                              f"Attempt: {attempt_id}\n"
                              f"User: {task.user_id}\n"
                              f"Task: {task.task_type} {task.ai_task_id}\nReceive count: {receive_count}\n"
                              f"Generation: {task.input.get('generation')}\n"
                              "Status: started (unfinished until an outcome is recorded)")
        except Exception:  # noqa: BLE001 - transcript failures must never affect task execution
            logger.warning("Conversation transcript could not be initialized")
    token = _current.set(transcript)
    try:
        yield
    finally:
        _current.reset(token)


async def observe_request(model, messages, model_settings, parameters):
    """Captures masked requests and raw responses without changing provider behavior."""
    transcript = _current.get()
    if transcript is None:
        return await model.request(messages, model_settings, parameters)
    request_id = uuid4()
    prefix = f"### Attempt {transcript.attempt} / Request {request_id}" if transcript else ""
    if transcript:
        try:
            state = _run.get()
            if state is not None:
                state.request_id, state.model = request_id, model.model_id
                state.provider_error = None
            transcript.append(f"{prefix} — Request snapshot — {_timestamp()}\n\nModel: {model.model_id}\n"
                              f"Fallback execution: {_fallback.get()[0] if _fallback.get() else None}\n\n"
                              + render_instructions(parameters) + render_messages(messages, parameters))
        except Exception:  # noqa: BLE001 - transcript failures must never affect task execution
            logger.warning("Conversation request could not be rendered")
    try:
        response = await model.request(messages, model_settings, parameters)
    except BaseException as error:
        # Provider exception text can contain restored contact values or arbitrary payloads.
        try:
            if state is not None:
                state.provider_error = error
            transcript.append(f"### PROVIDER FAILURE — Attempt {transcript.attempt} / Request {request_id} — {_timestamp()}\n\n"
                              f"Model: {model.model_id}\nProvider error: {type(error).__name__}\n\n"
                              "Partial response unavailable: the provider returned no response object.")
        except Exception:  # noqa: BLE001 - preserve the original provider error if logging fails
            logger.warning("Conversation provider error could not be rendered")
        raise
    if transcript:
        try:
            transcript.append(f"{prefix} — Response — {_timestamp()}\n\nModel: {response.model_name or model.model_id}\n\n"
                              + render_messages([response], parameters))
        except Exception:  # noqa: BLE001 - transcript failures must never affect task execution
            logger.warning("Conversation response could not be rendered")
    return response


def record_outcome(outcome, *, event="Outcome"):
    """Records lifecycle outcomes without changing queue or accounting behavior."""
    try:
        transcript = _current.get()
        if transcript:
            transcript.append(f"### {event} — Attempt {transcript.attempt} — {_timestamp()}\n\nOutcome: {outcome}")
    except Exception:  # noqa: BLE001 - transcript failures must never affect task execution
        logger.warning("Conversation outcome could not be rendered")


def record_fallback(source, destination, *, kind, execution):
    """Announce an explicit execution boundary without copying input or error payloads."""
    try:
        transcript = _current.get()
        if transcript is None:
            return
        state = _run.get()
        transcript.append(f"### FALLBACK EXECUTION — Attempt {transcript.attempt} — {_timestamp()}\n\n"
                          f"Fallback execution: {execution}\nKind: {kind}\n"
                          f"Run: {state.run_id if state else 'unavailable'}\n"
                          f"From model: {source}\nTo model: {destination}")
    except Exception:  # noqa: BLE001 - preserve fallback policy and execution
        logger.warning("Conversation fallback could not be rendered")


class _FallbackExecution(WrapperModel):
    """Observe only entry into an explicitly configured fallback target, never adjacency."""

    def __init__(self, model, source):
        super().__init__(model)
        self.source = source if isinstance(source, str) else source.model_id

    async def request(self, messages, model_settings, model_request_parameters):
        with fallback_execution(self.source, self.wrapped.model_id, kind="generative"):
            return await self.wrapped.request(messages, model_settings, model_request_parameters)


def observe_fallback_model(source, destination):
    """Keep disabled paths unchanged; wrap the target of the owner's fallback chain."""
    if _current.get() is None:
        return destination
    return _FallbackExecution(destination, source)


@contextmanager
def fallback_execution(source, destination, *, kind):
    """Link explicit fallback execution and its requests with isolated, nonfatal state."""
    if _current.get() is None:
        yield
        return
    try:
        execution = uuid4()
        state = _run.get()
        run_id = state.run_id if state and kind == "generative" else None
        record_fallback(source, destination, kind=kind, execution=execution)
        token = _fallback.set((execution, run_id))
    except Exception:  # noqa: BLE001 - setup failure cannot prevent provider execution
        logger.warning("Conversation fallback scope could not be initialized")
        token = None
    try:
        yield
    finally:
        if token is not None:
            _fallback.reset(token)
