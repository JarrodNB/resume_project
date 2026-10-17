"""Keep an import's privacy session alive through provider calls and trace completion.

Spans retain this opaque object before extraction; preparation adds detected contact to
that same object. Other task types continue using their existing profile protection.
"""

from collections.abc import Callable
from typing import Any

from pii import MaskingSession, prepare_document


class TaskPrivacy:
    """Task-local adapter; maps and profile callbacks never leave memory."""

    __slots__ = ("_mask_known", "_profile", "_session", "_unmask_known")

    def __init__(self, mask_known: Callable[[str], str], unmask_known: Callable[[str], str],
                 *, names=(), emails=(), phones=()):
        self._mask_known = mask_known
        self._unmask_known = unmask_known
        self._profile = {"names": names, "emails": emails, "phones": phones}
        self._session: MaskingSession | None = None

    def __repr__(self):
        return "TaskPrivacy()"

    def __reduce_ex__(self, protocol):
        raise TypeError("Privacy sessions must remain in memory")

    def prepare(self, text: str) -> str:
        """Attach local detection before either provider sees document text."""
        masked, self._session = prepare_document(text, **self._profile)
        return masked

    def mask(self, text: str) -> str:
        """Mask discovered values, or known profile contact before preparation."""
        return self._session.mask(text) if self._session is not None else self._mask_known(text)

    def unmask(self, text: str) -> str:
        """Defer import restoration until the handler has complete structured output."""
        return text if self._session is not None else self._unmask_known(text)

    def restore(self, value: Any) -> Any:
        """Restore structured import output before source checking and publication."""
        if self._session is None:
            raise RuntimeError("Document privacy has not been prepared")
        return self._session.restore(value)

    def original_length(self, text: str) -> int:
        """Measure an approved import prompt without counting replacement expansion.

        Callers must establish exact screening coverage before using this measurement.
        Unknown or malformed tokens still fail restoration; provider text stays masked.
        """
        return len(text) if self._session is None else len(self._session.unmask(text))
