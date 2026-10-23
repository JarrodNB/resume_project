"""Label source occurrences without deciding which career model owns them.

Every visible passage receives a global ID, including projects and skills. Bullet
continuations keep their original wording; only list markers and layout indent are removed.
Bullets have one disposition: role highlight, user placement, or non-experience evidence;
uncited bullets stay available for user placement instead of disappearing.
"""

import re
from dataclasses import dataclass
from itertools import islice

from pydantic import create_model, model_validator

from schemas.parsed_resume import ParsedResume
from schemas.resume_import import (
    ResumeImportExtraction,
    UnassignedReference,
    source_bound_extraction,
)

_CONTINUATION_END = re.compile(
    r"(?:\b(?:in|on|with|using|via|and|or|to|for|including)|[:,/&+])\s*$", re.IGNORECASE
)
_DATE = re.compile(r"(?:19|20)\d{2}.*(?:[-–—]|present|current)", re.IGNORECASE)
_SECTION = re.compile(
    r"^(?:summary|profile|experience|work experience|employment|education|skills|technical skills|projects|certifications|credentials|interests|languages)\s*:?$",
    re.IGNORECASE,
)


def _boundary(line: str, following: str, after_following: str = "", previous: str = "") -> bool:
    text = line.strip()
    # Capitalization alone is not structural evidence: SQL and AWS often wrap.
    if _SECTION.fullmatch(text):
        return True
    if len(text) > 140 or text.endswith((".", "!", "?")):
        return False
    # Company and title labels can precede a separate date range, even for IBM.
    # A trailing connector ("reporting in" / "deployed to") instead supports a
    # wrapped continuation such as SQL or AWS before the next role header.
    title = following.strip()
    if (
        _DATE.search(after_following.strip())
        and not _CONTINUATION_END.search(previous)
        and 0 < len(title) <= 140
        and not title.endswith((".", "!", "?"))
    ):
        return True
    return bool(
        _DATE.search(text) or _DATE.search(following.strip()) or re.search(r"\s[|–—]\s", text)
    )


_BULLET = re.compile(r"^\s*(?:[•●▪◦‣⁃✓*+\-–—]|\d+[.)])\s+(.*)$")

_EMPTY_LIST_MARKER = re.compile(r"^\s*[•●▪◦‣⁃✓*+\-–—]\s*$")


def _text_key(text: str) -> str:
    """Compare verbatim words while ignoring list display markers and layout whitespace."""
    lines = []
    for line in text.splitlines():
        marker = _BULLET.match(line)
        lines.append(marker.group(1) if marker else line)
    return " ".join(" ".join(lines).split())


def _field_texts(value) -> set[str]:
    """Find complete field values and explicitly marked list items, without paraphrase matching."""
    if isinstance(value, dict):
        return set().union(*(_field_texts(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(_field_texts(item) for item in value))
    if not isinstance(value, str):
        return set()
    texts = {_text_key(value)}
    item = []
    for line in value.splitlines():
        marker = _BULLET.match(line)
        if marker or not line.strip():
            if item:
                texts.add(_text_key("\n".join(item)))
            item = [marker.group(1)] if marker else []
        elif item:
            item.append(line)
    if item:
        texts.add(_text_key("\n".join(item)))
    return texts


def _allowed_ids(source_ids) -> str:
    """Keep membership retry messages useful without echoing a very long registry."""
    sample = list(islice(source_ids, 17))
    return ", ".join(sample[:16]) + (
        "; see remaining labels in this chunk" if len(sample) > 16 else ""
    )


@dataclass(frozen=True)
class Passage:
    text: str
    context: str
    bullet: bool
    start_line: int
    end_line: int


class ResumeSource:
    """Own neutral IDs, output validation, and reconstruction for one document."""

    def __init__(self, text: str):
        self.passages: dict[str, Passage] = {}
        annotated = []
        context = []
        lines = text.splitlines()
        index = 0
        while index < len(lines):
            line = lines[index]
            if not line.strip():
                annotated.append(line)
                index += 1
                continue
            start_line = index
            match = _BULLET.match(line)
            if match is None and _EMPTY_LIST_MARKER.fullmatch(line):
                match = _BULLET.match(line + " ")
            source_id = f"S{len(self.passages) + 1}"
            parts = [match.group(1) if match else line.strip()]
            annotation_start = len(annotated)
            annotated.append(f"[{source_id}] {line}")
            index += 1
            if match:
                while index < len(lines):
                    following = lines[index]
                    if (
                        not following.strip()
                        or _BULLET.match(following)
                        or _EMPTY_LIST_MARKER.fullmatch(following)
                    ):
                        break
                    # Capitalized words also wrap. Stop only for confident heading/date
                    # evidence rather than treating capitalization as a new entry.
                    after = lines[index + 1] if index + 1 < len(lines) else ""
                    after_next = lines[index + 2] if index + 2 < len(lines) else ""
                    if _boundary(following, after, after_next, parts[-1]):
                        break
                    parts.append(following.strip())
                    annotated.append(following)
                    index += 1
            if match and not any(part.strip() for part in parts):
                # DOCX can contain an empty List Bullet paragraph. It carries no
                # source fact, so keep the layout but do not create a placement item.
                annotated[annotation_start] = line
                continue
            if match and not parts[0].strip():
                parts = parts[1:]
            self.passages[source_id] = Passage(
                "\n".join(parts), "\n".join(context[-3:]), bool(match), start_line, index
            )
            if not match:
                context.append(line.strip())
        self.annotated_text = "\n".join(annotated)

        self._configure_output()

    def subset(self, owned: set[str]) -> "ResumeSource":
        """Use the original registry for one chunk without reassigning source IDs."""
        subset = object.__new__(ResumeSource)
        subset.passages = {key: passage for key, passage in self.passages.items() if key in owned}
        subset._configure_output()
        return subset

    def _configure_output(self):
        def validate_references(output):
            self.validate(output)
            return output

        self.output_type = create_model(
            "ValidatedResumeImportExtraction",
            __base__=source_bound_extraction(
                tuple(self.passages),
                tuple(key for key, passage in self.passages.items() if passage.bullet),
            ),
            __validators__={
                "validate_references": model_validator(mode="after")(validate_references)
            },
        )

    def validate(self, output: ResumeImportExtraction) -> set[str]:
        """Reject invalid ownership and return all sources represented by the output."""
        bullet_text_ids = {}
        for source_id, passage in self.passages.items():
            if passage.bullet:
                bullet_text_ids.setdefault(_text_key(passage.text), set()).add(source_id)
        covered = set()
        seen = set()
        singleton = set()
        for record in output.records:
            if record.source_id not in self.passages:
                raise ValueError(
                    f"Use a bare source ID without brackets or source text; allowed IDs: {_allowed_ids(iter(self.passages))}."
                )
            if record.type in ("contact", "summary"):
                if record.type in singleton:
                    raise ValueError("Return only one contact and one summary record.")
                singleton.add(record.type)
            if record.type == "experience":
                for source_id in record.fields.highlight_ids:
                    self._claim_bullet(source_id, seen)
            else:
                evidence = {record.source_id, *record.supporting_ids}
                for source_id in evidence:
                    if source_id not in self.passages:
                        raise ValueError(
                            f"Supporting IDs must be bare owned IDs: {_allowed_ids(iter(self.passages))}."
                        )
                    covered.add(source_id)
                nonbullet_evidence = [
                    _text_key(self.passages[key].text)
                    for key in evidence
                    if not self.passages[key].bullet
                ]
                for text in _field_texts(record.fields.model_dump()):
                    matching_ids = bullet_text_ids.get(text, set())
                    # An independently cited heading/paragraph can state the same
                    # words as an unrelated bullet. Do not manufacture its ownership.
                    stated_outside_bullets = matching_ids and any(
                        re.search(r"(?<!\w)" + re.escape(text) + r"(?!\w)", passage)
                        for passage in nonbullet_evidence
                    )
                    if matching_ids and not matching_ids & evidence and not stated_outside_bullets:
                        raise ValueError(
                            "Non-experience fields reproduce a source bullet: cite its exact "
                            "occurrence in source_id or supporting_ids. Matching owned bullet IDs: "
                            f"{_allowed_ids(iter(sorted(matching_ids)))}. Choose the represented "
                            "occurrence; identical wording does not claim every occurrence."
                        )
        for reference in output.unassigned_highlights:
            self._claim_bullet(reference.source_id, seen)
        overlap = seen & covered
        if overlap:
            raise ValueError(
                f"Bullet IDs {_allowed_ids(iter(sorted(overlap)))} have conflicting dispositions: "
                "choose experience highlight, unassigned, or non-experience evidence, never both."
            )
        return seen | covered

    def _claim_bullet(self, source_id, seen):
        if source_id not in self.passages or not self.passages[source_id].bullet:
            raise ValueError(
                f"Use a bare owned bullet ID, without brackets; allowed bullet IDs: {_allowed_ids(key for key, passage in self.passages.items() if passage.bullet)}."
            )
        if source_id in seen:
            raise ValueError(
                f"Source bullet {source_id} may appear in highlight_ids or unassigned_highlights only once."
            )
        seen.add(source_id)

    def reconstruct(self, output: ResumeImportExtraction) -> ParsedResume:
        """Return the public schema in source order, copying bullet text and context locally."""
        covered = self.validate(output)
        pending = list(output.unassigned_highlights)
        pending.extend(
            UnassignedReference(source_id=key, reason="ambiguous_role")
            for key, passage in self.passages.items()
            if passage.bullet and key not in covered
        )
        order = {source_id: index for index, source_id in enumerate(self.passages)}
        fields = {"parsing_warnings": list(dict.fromkeys(output.parsing_warnings))}
        plural = {
            "experience": "experiences",
            "project": "projects",
            "education": "educations",
            "certification": "certifications",
            "skill": "skills",
        }
        for record in sorted(output.records, key=lambda item: order[item.source_id]):
            values = record.fields.model_dump()
            if record.type == "experience":
                values["highlights"] = [
                    self.passages[key].text
                    for key in sorted(values.pop("highlight_ids"), key=order.__getitem__)
                ]
            if record.type == "summary":
                fields["summary"] = values["text"]
            elif record.type == "contact":
                fields["contact"] = values
            else:
                fields.setdefault(plural[record.type], []).append(values)
        fields["unassigned_highlights"] = [
            {
                "source_id": reference.source_id,
                "text": self.passages[reference.source_id].text,
                "source_context": self.passages[reference.source_id].context,
                "reason": reference.reason,
            }
            for reference in sorted(pending, key=lambda item: order[item.source_id])
        ]
        return ParsedResume(**fields)
