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

_TOKEN = re.compile(r"«pii:[^«»\s]+»", re.IGNORECASE)
_SOURCE_TOKEN = re.compile(
    r"«(?:pii:[^«»\s]*(?:»|(?=\s|$))|(?:name|email|phone)(?:-\d+)?»)", re.IGNORECASE
)
_ENTITY_TYPES = ("PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER")
_MONTH_RANGE = re.compile(
    r"(?:0?[1-9]|1[0-2])[/.-](?:19|20)\d{2}\s*[-–—]\s*"
    r"(?:0?[1-9]|1[0-2])[/.-](?:19|20)\d{2}"
)


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

    __slots__ = ("__folded", "__pattern", "__replacements")

    def __init__(self, replacements: dict[str, str]):
        self.__replacements = replacements
        self.__folded = {value.casefold(): token for value, token in replacements.items()}
        self.__pattern = (
            re.compile(_TOKEN.pattern + "|" + "|".join(
                re.escape(value) if _SOURCE_TOKEN.fullmatch(value)
                else rf"(?<!\w){re.escape(value)}(?!\w)"
                for value in sorted(replacements, key=len, reverse=True)
            ), re.IGNORECASE)
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
        def replacement(match):
            value = match.group()
            # Protect generated tokens from subsequent hooks and marker-like names.
            if _TOKEN.fullmatch(value):
                return self.__replacements.get(value, value)
            return self.__replacements.get(value, self.__folded.get(value.casefold(), value))

        return self.__pattern.sub(replacement, text)

    def unmask(self, text: str) -> str:
        """Restore one string, rejecting unknown generated placeholders."""
        if "«pii:" in _TOKEN.sub("", text).casefold():
            raise PiiRestorationError("Result contains an unresolved privacy placeholder")
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


def _detect_spans(text: str) -> list[tuple[int, int, str]]:
    """Keep contact types distinct and keep resume layout out of person spans."""
    analyzer = _analyzer()
    matches = analyzer.analyze(
        text=text, language="en", entities=["EMAIL_ADDRESS", "PHONE_NUMBER"]
    )
    spans = [
        (match.start, match.end, match.entity_type)
        for match in matches
        if not (
            match.entity_type == "PHONE_NUMBER"
            and _MONTH_RANGE.fullmatch(text[match.start:match.end])
        )
    ]
    # NLP can merge a name with the next line or column. Names are recognized in
    # each layout segment; structured contacts retain priority over person guesses.
    for segment in re.finditer(r"[^\r\n]+", text):
        for column in re.finditer(r"\S.*?(?=\s{2,}|\t|$)", segment.group()):
            value = column.group().rstrip()
            offset = segment.start() + column.start()
            without_bullet = re.sub(r"^[•●▪◦*-]\s*", "", value)
            offset += len(value) - len(without_bullet)
            for match in analyzer.analyze(text=without_bullet, language="en", entities=["PERSON"]):
                start, end = offset + match.start, offset + match.end
                if not any(start < old_end and end > old_start for old_start, old_end, _ in spans):
                    spans.append((start, end, "PERSON"))
    return spans


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
        spans = _detect_spans(text)
        profile_values = []
        for entity, values in zip(_ENTITY_TYPES, (names, emails, phones), strict=True):
            for value in values:
                if isinstance(value, str) and value.strip():
                    profile_values.append((value.strip(), entity))
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
        values.update(profile_values)
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
