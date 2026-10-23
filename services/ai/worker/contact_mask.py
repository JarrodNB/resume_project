"""
Description: Replaces the user's known name, contact email, and phone with placeholders
before a model call, an embedding, or a telemetry export. Imports attach a local detector
session before screening and explicitly restore structured results before source checks.
Other task types restore profile contact on the model response.
Index:
    - contact_scope: applies a KnownContact to the current task
    - using_known_contact: loads the profile and applies it for one task
    - current_known_contact: privacy object retained before asynchronous telemetry export
    - mask_outbound: masks one string with the current task's contact
    - install_contact_hook: adds the model-request hook to one agent
    - install_contact_hooks: adds it to every worker agent
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import fields, is_dataclass, replace
from typing import Any

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.capabilities import Hooks

from database.open_read_only_connection import open_read_only_connection
from database.profile_contact import read_profile_contact
from pii.task_privacy import TaskPrivacy
from worker.known_contact import KnownContact
from worker.queue_messages import AiTaskMessage
from worker.settings import load_settings

_current: ContextVar[KnownContact | TaskPrivacy] = ContextVar("known_contact")
_installed: set[int] = set()


def mask_outbound(text: str) -> str:
    """Masks `text` with the contact for the current task, or returns it unchanged."""
    contact = _current.get(None)
    if contact is None:
        return text
    return contact.mask(text)


def current_known_contact() -> KnownContact | TaskPrivacy:
    """Returns the task privacy object retained by spans through completion."""
    return _current.get(KnownContact())


def covered_prompt_length(text: str) -> int:
    """Measure exact screened import prompts using original text; others use plain length.

    The screening caller owns coverage verification. No unmasked text leaves this adapter.
    """
    privacy = _current.get(None)
    return privacy.original_length(text) if isinstance(privacy, TaskPrivacy) else len(text)


@contextmanager
def contact_scope(contact: KnownContact | TaskPrivacy) -> Iterator[None]:
    """Applies `contact` until the block exits."""
    token = _current.set(contact)
    try:
        yield
    finally:
        _current.reset(token)


@contextmanager
def using_known_contact(task: AiTaskMessage) -> Iterator[None]:
    """Loads the user's name, contact email, and phone and applies them for one task."""
    if _current.get(None) is not None:
        yield
        return
    contact = _load_known_contact(task)
    if task.task_type == "parse_resume":
        with import_privacy_scope(contact):
            yield
        return
    with contact_scope(contact):
        yield


@contextmanager
def import_privacy_scope(contact: KnownContact | None = None) -> Iterator[TaskPrivacy]:
    """Reuse worker privacy, or protect a standalone import without a database read."""
    current = _current.get(None)
    if isinstance(current, TaskPrivacy):
        yield current
        return
    known = contact or current or KnownContact()
    profile = {"names": [], "emails": [], "phones": []}
    for value, token, _pattern in known.pairs:
        key = "names" if token.startswith("«name") else (
            "emails" if token.startswith("«email") else "phones"
        )
        profile[key].append(value)
    privacy = TaskPrivacy(known.mask, known.unmask, **profile)
    with contact_scope(privacy):
        yield privacy


def install_contact_hook(agent: Agent[Any, Any]) -> None:
    """Masks the request the model is about to see, then restores the response."""
    if id(agent) in _installed:
        return
    agent._root_capability.capabilities.insert(
        0, Hooks(before_model_request=_mask_request, after_model_request=_unmask_response)
    )
    _installed.add(id(agent))


def install_contact_hooks() -> None:
    """Installs the mask hook on every worker agent. Call once, from configure_tracing."""
    from agents.gap_analysis_agent import gap_analysis_agent
    from agents.interview_clarification_agent import interview_clarification_agent
    from agents.interview_feedback_agent import interview_feedback_agent
    from agents.interview_questions_agent import interview_questions_agent
    from agents.job_requirements_sorting_agent import job_requirements_sorting_agent
    from agents.parse_job_posting_agent import parse_job_posting_agent
    from agents.resume_parsing_agent import resume_parsing_agent
    from agents.resume_tailoring_agent import resume_tailoring_agent
    from agents.user_text_screen_agent import user_text_screen_agent

    for agent in (
        resume_parsing_agent,
        job_requirements_sorting_agent,
        parse_job_posting_agent,
        gap_analysis_agent,
        interview_questions_agent,
        interview_feedback_agent,
        interview_clarification_agent,
        user_text_screen_agent,
        resume_tailoring_agent,
    ):
        install_contact_hook(agent)


def _load_known_contact(task: AiTaskMessage) -> KnownContact:
    """Profile columns plus the tailoring snapshot, when the task carries one."""
    with open_read_only_connection(load_settings()) as connection:
        name, email, phone = read_profile_contact(connection, task.user_id)
    snapshot = task.input.get("contact")
    if not isinstance(snapshot, dict):
        snapshot = {}
    return KnownContact.from_values(
        names=[name, snapshot.get("full_name")],
        emails=[email, snapshot.get("email")],
        phones=[phone, snapshot.get("phone")],
    )


def _mask_request(ctx: Any, request_context: Any) -> Any:
    """Rewrites the request that is about to be sent."""
    contact = _current.get(None)
    if contact is None:
        return request_context
    return replace(
        request_context,
        messages=_map_strings(request_context.messages, contact.mask),
        model_request_parameters=_map_strings(request_context.model_request_parameters, contact.mask),
    )


def _unmask_response(ctx: Any, *, request_context: Any, response: Any) -> Any:
    """Restores known contact on the model response before the app checks or stores it."""
    contact = _current.get(None)
    if contact is None:
        return response
    return _map_strings(response, contact.unmask)


def _map_strings(value: Any, transform: Callable[[str], str]) -> Any:
    """Applies `transform` to strings inside dicts, lists, models, and dataclasses."""
    if isinstance(value, str):
        return transform(value)
    if isinstance(value, BaseModel):
        updates = {
            name: mapped
            for name in type(value).model_fields
            if (mapped := _map_strings(getattr(value, name), transform)) is not getattr(value, name)
        }
        return value.model_copy(update=updates) if updates else value
    if is_dataclass(value) and not isinstance(value, type):
        updates = {}
        for field in fields(value):
            if not field.init:
                continue
            current = getattr(value, field.name)
            mapped = _map_strings(current, transform)
            if mapped is not current:
                updates[field.name] = mapped
        return replace(value, **updates) if updates else value
    if isinstance(value, list):
        mapped = [_map_strings(item, transform) for item in value]
        return value if all(new is old for new, old in zip(mapped, value)) else mapped
    if isinstance(value, tuple):
        mapped = tuple(_map_strings(item, transform) for item in value)
        return value if all(new is old for new, old in zip(mapped, value)) else mapped
    if isinstance(value, dict):
        mapped = {key: _map_strings(item, transform) for key, item in value.items()}
        return value if all(mapped[key] is item for key, item in value.items()) else mapped
    return value
