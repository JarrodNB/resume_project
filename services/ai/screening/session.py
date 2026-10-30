"""Remember screening decisions only while one task execution is running.

Trusted prompt builders may bind their exact rendered prompt to allowed source strings.
Builders must render all untrusted values from the supplied sources, never from hidden
closure state. Binding is exact; it never subtracts substrings from an unknown prompt.
"""

from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
from time import monotonic
from typing import Any

from privacy.contact_mask import mask_outbound


@dataclass
class ScreeningSession:
    """Mutable execution state shared across asyncio.run context copies, never deliveries."""

    deadline: float
    decisions: dict[tuple, Any] = field(default_factory=dict)
    async_locks: dict[tuple, Any] = field(default_factory=dict)
    allowed_sources: set[str] = field(default_factory=set)
    trusted_generated_sources: set[str] = field(default_factory=set)
    prompts: set[str] = field(default_factory=set)
    library_screening: list[Any] = field(default_factory=list)
    job_screening: list[Any] = field(default_factory=list)
    gap_response_screening: list[Any] = field(default_factory=list)
    interview_question_screening: list[Any] = field(default_factory=list)
    record_screening: list[Any] = field(default_factory=list)


_current: ContextVar[ScreeningSession | None] = ContextVar("screening_session", default=None)


def current_session() -> ScreeningSession | None:
    """Return the execution's state, if a boundary has established one."""
    return _current.get()


def remaining_timeout(timeout_seconds: float) -> float:
    """Bound later generation by the same execution deadline as earlier screening."""
    session = _current.get()
    remaining = timeout_seconds if session is None else min(timeout_seconds, session.deadline - monotonic())
    if remaining <= 0:
        raise TimeoutError("Task screening and generation deadline exceeded")
    return remaining


@contextmanager
def screening_session(timeout_seconds: float = 240, *, reuse: bool = False) -> Iterator[ScreeningSession]:
    """Start fresh coverage, or explicitly reuse an enclosing task for a helper call."""
    if reuse and _current.get() is not None:
        yield _current.get()
        return
    token = _current.set(ScreeningSession(monotonic() + timeout_seconds))
    try:
        yield _current.get()
    finally:
        _current.reset(token)


def within_screening_session(function):
    """Keep standalone synchronous entry points isolated while reusing a worker scope."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        from settings import load_settings

        with screening_session(load_settings().llm_run_timeout_seconds, reuse=True):
            return function(*args, **kwargs)
    return wrapped


def approve_projected_source(
    source: str, checked_text: str, project: Callable[[str], str], decision: Any,
) -> None:
    """Approve a serialized source only when its checked projection matches exactly.

    Use this when screening receives readable text but a trusted builder reconstructs
    its source from a serialized snapshot. The projection must cover every user-authored
    field the builder can render from that snapshot.
    """
    if not getattr(decision, "allowed", False) or project(source) != checked_text:
        raise ValueError("The approved source does not match screened text")
    if (session := _current.get()) is not None:
        session.allowed_sources.add(mask_outbound(source))


def trust_generated_source(source: str) -> None:
    """Cover immutable AI output from an earlier owned task in this execution only.

    Callers must validate its saved result shape and provenance. Never use this for
    user-editable fields or text arriving directly from a browser or external site.
    """
    if source and (session := _current.get()) is not None:
        session.trusted_generated_sources.add(mask_outbound(source))


def trust_rails_screened_source(source: str) -> None:
    """Cover immutable text that Rails accepted after a successful screen, in this execution.

    Use this only for text that cannot change once Rails accepted it, such as completed
    interview dialogue or accepted chat history. Unlike `trust_generated_source`, the text
    may be user-written: its approval comes from that earlier screen, not from AI output.
    Editable saved fields never use this; they go through `screening.records`.
    """
    if source and (session := _current.get()) is not None:
        session.allowed_sources.add(mask_outbound(source))


def bind_screened_prompt(sources: Sequence[str], render: Callable[[Sequence[str]], str]) -> str:
    """Render trusted scaffolding around screened or trusted generated source values.

    The renderer owns escaping and formatting. Every untrusted value it includes must
    appear in sources; do not capture untrusted values in its closure. No approval is
    minted when a source lacks screening or explicit generated-output provenance.
    """
    prompt = render(sources)
    session = _current.get()
    if session is not None and sources and all(
        mask_outbound(source) in session.allowed_sources or
        mask_outbound(source) in session.trusted_generated_sources for source in sources
    ):
        session.prompts.add(mask_outbound(prompt))
    return prompt


def prompt_is_covered(prompt: str) -> bool:
    """Only an exact rendered prompt approved in this execution has coverage."""
    session = _current.get()
    return session is not None and mask_outbound(prompt) in session.prompts
