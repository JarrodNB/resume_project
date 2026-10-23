"""Label source occurrences without deciding which career model owns them.

Every visible passage receives a global ID, including projects and skills. Bullet
continuations keep their original wording; only list markers and layout indent are removed.
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
            source_id = f"S{len(self.passages) + 1}"
            parts = [match.group(1) if match else line.strip()]
            annotated.append(f"[{source_id}] {line}")
            index += 1
            if match:
                while index < len(lines):
                    following = lines[index]
                    if not following.strip() or _BULLET.match(following):
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
                for source_id in [record.source_id, *record.supporting_ids]:
                    if source_id not in self.passages:
                        raise ValueError(
                            f"Supporting IDs must be bare owned IDs: {_allowed_ids(iter(self.passages))}."
                        )
                    covered.add(source_id)
        for reference in output.unassigned_highlights:
            self._claim_bullet(reference.source_id, seen)
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
