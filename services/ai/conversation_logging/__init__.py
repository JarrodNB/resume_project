"""
Description: Local transcript capture independent of provider accounting.
Index:
    - conversation_scope: task identity and validated file grouping
    - observe_request: masked model exchange capture
"""
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from conversation_logging.render import render_messages, render_parameters

logger = logging.getLogger(__name__)


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
                stream.write(text + "\n\n")
        except Exception:  # noqa: BLE001 - transcript failures must never affect task execution
            logger.warning("Conversation transcript could not be written")


_current = ContextVar("conversation_transcript", default=None)


def _group(task):
    """Groups only validated UUIDs; missing/invalid identifiers use the task."""
    key = "job_id" if task.task_type in ("analyze_gaps", "tailor_resume") else "question_set_id"
    if task.task_type in ("analyze_gaps", "tailor_resume", "generate_interview_questions",
                          "regenerate_interview_question", "review_interview_answer"):
        try:
            return key.removesuffix("_id"), UUID(str(task.input.get(key)))
        except (ValueError, TypeError, AttributeError):
            pass
    return "task", task.ai_task_id


def _timestamp():
    """Returns readable UTC time for each observed block."""
    return datetime.now(UTC).isoformat()


@contextmanager
def conversation_scope(task, settings, attempt_id, receive_count):
    """Enables capture solely in explicit local worker execution, with an opt-out."""
    transcript = None
    if settings.worker_environment == "local" and settings.conversation_logging_enabled:
        try:
            kind, group = _group(task)
            transcript = Transcript(Path("conversation_logs") / str(task.user_id) / f"{kind}-{group}.md", attempt_id)
            transcript.append(f"## Attempt {attempt_id} — {_timestamp()}\n\n"
                              f"User: {task.user_id}\nGroup: {kind} {group}\n"
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
            transcript.append(f"{prefix} — Request snapshot — {_timestamp()}\n\nModel: {model.model_id}\n\n"
                              + render_messages(messages, parameters) + render_parameters(parameters))
        except Exception:  # noqa: BLE001 - transcript failures must never affect task execution
            logger.warning("Conversation request could not be rendered")
    response = await model.request(messages, model_settings, parameters)
    if transcript:
        try:
            transcript.append(f"{prefix} — Response — {_timestamp()}\n\nModel: {response.model_name or model.model_id}\n\n"
                              + render_messages([response], parameters))
        except Exception:  # noqa: BLE001 - transcript failures must never affect task execution
            logger.warning("Conversation response could not be rendered")
    return response
