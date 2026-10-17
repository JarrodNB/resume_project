"""Keep imported contact details local until structured results can be restored.

The cached English detector never downloads assets at runtime. Each preparation owns
an independent in-memory map; neither its representation nor errors reveal that map.
Detection is probabilistic, especially for unfamiliar names and phone formats.
"""

import re
from collections.abc import Iterable
from functools import lru_cache
from typing import Any
from uuid import uuid4

from pydantic import BaseModel

_TOKEN = re.compile(r"«pii:[^«»\s]+»")
_SOURCE_TOKEN = re.compile(r"«(?:pii:[^«»\s]+|(?:name|email|phone)(?:-\d+)?)»")
_ENTITY_TYPES = ("PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER")


class PiiDetectionError(RuntimeError):
    """The local detector could not safely prepare this document."""


class PiiRestorationError(ValueError):
    """A result contains an unresolved generated privacy placeholder."""


@lru_cache(maxsize=1)
def _analyzer():
    # Load explicitly first: Presidio's normal loader can download absent models.
    import spacy
    from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
    from presidio_analyzer.nlp_engine import SpacyNlpEngine
    from presidio_analyzer.predefined_recognizers import (
        EmailRecognizer,
        PhoneRecognizer,
        SpacyRecognizer,
    )

    class LocalEmailRecognizer(EmailRecognizer):
        # Presidio's default email validator refreshes a public suffix list online.
        # Keep its structural pattern, including private/test email domains, without
        # consulting that list. None preserves the pattern's original confidence.

        def validate_result(self, pattern_text: str):
            return None

    model = spacy.load("en_core_web_sm")
    engine = SpacyNlpEngine(models=[{"lang_code": "en", "model_name": "en_core_web_sm"}])
    engine.nlp = {"en": model}
    registry = RecognizerRegistry(
        supported_languages=["en"],
        recognizers=[
            SpacyRecognizer(supported_entities=["PERSON"]),
            LocalEmailRecognizer(),
            PhoneRecognizer(),
        ],
    )
    return AnalyzerEngine(nlp_engine=engine, registry=registry, supported_languages=["en"])


class MaskingSession:
    """Opaque reversible replacements for one import; safe to retain through span export."""

    __slots__ = ("__pattern", "__replacements")

    def __init__(self, replacements: dict[str, str]):
        self.__replacements = replacements
        self.__pattern = (
            re.compile("|".join(
                re.escape(value) if _SOURCE_TOKEN.fullmatch(value)
                else rf"(?<!\w){re.escape(value)}(?!\w)"
                for value in sorted(replacements, key=len, reverse=True)
            ))
            if replacements else None
        )

    def __repr__(self):
        return "MaskingSession()"

    def __reduce_ex__(self, protocol):
        raise TypeError("Privacy sessions must remain in memory")

    def mask(self, text: str) -> str:
        """Protect already discovered values in requests, responses, and telemetry."""
        if self.__pattern is None:
            return text
        return self.__pattern.sub(lambda match: self.__replacements[match.group()], text)

    def unmask(self, text: str) -> str:
        """Restore one string, rejecting unknown generated placeholders."""
        originals = {token: value for value, token in self.__replacements.items()}

        def original(match):
            token = match.group()
            if token not in originals:
                raise PiiRestorationError("Result contains an unresolved privacy placeholder")
            return originals[token]

        # One pass keeps literal placeholder-looking source text intact after restoration.
        return _TOKEN.sub(original, text)

    def restore(self, value: Any) -> Any:
        """Return restored strings recursively without mutating structured results."""
        if isinstance(value, str):
            return self.unmask(value)
        if isinstance(value, BaseModel):
            return type(value).model_validate(self.restore(value.model_dump(mode="python")))
        if isinstance(value, dict):
            return {self.restore(key): self.restore(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.restore(item) for item in value]
        if isinstance(value, tuple):
            return tuple(self.restore(item) for item in value)
        return value


def prepare_document(
    text: str,
    *,
    names: Iterable[str] = (),
    emails: Iterable[str] = (),
    phones: Iterable[str] = (),
) -> tuple[str, MaskingSession]:
    """Detect locally and return protected text and an opaque per-import session.

    Optional profile values augment detection and share its namespace. Exact source
    variants get separate tokens, preserving capitalization on restoration. Exceptions
    deliberately omit detector messages and source text.
    """
    try:
        matches = _analyzer().analyze(text=text, language="en", entities=list(_ENTITY_TYPES))
        spans = [(match.start, match.end, match.entity_type) for match in matches]
        for entity, values in zip(_ENTITY_TYPES, (names, emails, phones), strict=True):
            for value in values:
                if isinstance(value, str) and value.strip():
                    spans.extend(
                        (match.start(), match.end(), entity)
                        for match in re.finditer(
                            rf"(?<!\w){re.escape(value.strip())}(?!\w)", text, re.IGNORECASE
                        )
                    )
        # Prefer larger spans so a name inside an email cannot split that email.
        chosen = []
        for start, end, entity in sorted(spans, key=lambda span: (-(span[1] - span[0]), span[0])):
            if not any(start < old_end and end > old_start for old_start, old_end, _ in chosen):
                chosen.append((start, end, entity))
        values = {(text[start:end], entity) for start, end, entity in chosen}
        values.update((match.group(), "LITERAL") for match in _SOURCE_TOKEN.finditer(text))
        namespace = uuid4().hex
        while namespace in text:
            namespace = uuid4().hex
        replacements = {
            value: f"«pii:{namespace}:{entity}:{index}»"
            for index, (value, entity) in enumerate(sorted(values), start=1)
        }
        session = MaskingSession(replacements)
        return session.mask(text), session
    except Exception:  # noqa: BLE001 -- third-party errors must never expose source text
        raise PiiDetectionError("Local contact detection is unavailable") from None
