"""
Description: The user's known name, contact email, and phone, and the placeholders that
stand in for them. Nothing here discovers contact by scanning a document.
Index:
    - KnownContact: replacement pairs for one task
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

_MIN_PHONE_LENGTH = 7


@dataclass(frozen=True)
class KnownContact:
    """Secrets and the placeholders that stand in for them, longest secret first."""

    pairs: tuple[tuple[str, str, re.Pattern[str]], ...] = ()

    @classmethod
    def from_values(
        cls,
        *,
        names: list[Any] | None = None,
        emails: list[Any] | None = None,
        phones: list[Any] | None = None,
    ) -> "KnownContact":
        """One value uses «name», «email», or «phone»; extras are numbered."""
        labeled = (
            _labeled("name", names or [], _usable_name)
            + _labeled("email", emails or [], _usable_email)
            + _labeled("phone", phones or [], _usable_phone)
        )
        labeled.sort(key=lambda item: len(item[0]), reverse=True)
        return cls(
            tuple(
                (secret, placeholder, re.compile(rf"(?<!\w){re.escape(secret)}(?!\w)", re.IGNORECASE))
                for secret, placeholder in labeled
            )
        )

    def mask(self, text: str) -> str:
        """Replaces each known value with its placeholder."""
        masked = text
        for _secret, placeholder, pattern in self.pairs:
            masked = pattern.sub(placeholder, masked)
        return masked

    def unmask(self, text: str) -> str:
        """Puts the known values back. Longer placeholders go first."""
        restored = text
        for secret, placeholder, _pattern in sorted(self.pairs, key=lambda item: len(item[1]), reverse=True):
            restored = restored.replace(placeholder, secret)
        return restored


def _labeled(label: str, values: list[Any], usable: Callable[[str], bool]) -> list[tuple[str, str]]:
    """Unique usable strings, in order, each with a placeholder."""
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        key = cleaned.casefold()
        if not cleaned or key in seen or "«" in cleaned or not usable(cleaned):
            continue
        seen.add(key)
        unique.append(cleaned)
    return [
        (secret, f"«{label}»" if len(unique) == 1 else f"«{label}-{index}»")
        for index, secret in enumerate(unique, start=1)
    ]


def _usable_name(value: str) -> bool:
    return len(value) >= 2 and any(character.isalpha() for character in value)


def _usable_email(value: str) -> bool:
    return "@" in value


def _usable_phone(value: str) -> bool:
    return len(value) >= _MIN_PHONE_LENGTH and any(character.isdigit() for character in value)
