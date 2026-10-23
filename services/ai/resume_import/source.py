"""Label source occurrences without deciding which career model owns them.

Every visible passage receives a global ID, including projects and skills. Bullet
continuations keep their original wording; only list markers and layout indent are removed.
"""

import re
from dataclasses import dataclass

from pydantic import create_model, model_validator

from schemas.parsed_resume import ParsedResume
from schemas.resume_import import ResumeImportExtraction

_DATE = re.compile(r"(?:19|20)\d{2}.*(?:[-–—]|present|current)", re.IGNORECASE)
_SECTION = re.compile(
    r"^(?:summary|profile|experience|work experience|employment|education|skills|technical skills|projects|certifications|credentials|interests|languages)\s*:?$",
    re.IGNORECASE,
)


def _boundary(line: str, following: str, after_following: str = "") -> bool:
    text = line.strip()
    # Capitalization alone is not structural evidence: SQL and AWS often wrap.
    if _SECTION.fullmatch(text):
        return True
    if len(text) > 140 or text.endswith((".", "!", "?")):
        return False
    # A multiword company label and title can precede a separate date range.
    # Keep both labels out of the preceding bullet without treating capitalization
    # alone as evidence: acronyms such as SQL can still be wrapped continuations.
    title = following.strip()
    if (
        len(text.split()) >= 2
        and _DATE.search(after_following.strip())
        and 0 < len(title) <= 140
        and not title.endswith((".", "!", "?"))
    ):
        return True
    return bool(
        _DATE.search(text) or _DATE.search(following.strip()) or re.search(r"\s[|–—]\s", text)
    )


_BULLET = re.compile(r"^\s*(?:[•●▪◦‣⁃✓*+\-–—]|\d+[.)])\s+(.*)$")


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
                    if _boundary(following, after, after_next):
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
            __base__=ResumeImportExtraction,
            __validators__={
                "validate_references": model_validator(mode="after")(validate_references)
            },
        )

    def validate(self, output: ResumeImportExtraction) -> None:
        """Reject foreign IDs, repeated ownership, and conflicting singleton records."""
        seen = set()
        singleton = set()
        for record in output.records:
            if record.source_id not in self.passages:
                raise ValueError("Record source_id must reference a known source passage.")
            if record.type in ("contact", "summary"):
                if record.type in singleton:
                    raise ValueError("Return only one contact and one summary record.")
                singleton.add(record.type)
            if record.type == "experience":
                for source_id in record.fields.highlight_ids:
                    self._claim_bullet(source_id, seen)
        for reference in output.unassigned_highlights:
            self._claim_bullet(reference.source_id, seen)

    def _claim_bullet(self, source_id, seen):
        if source_id not in self.passages or not self.passages[source_id].bullet:
            raise ValueError("Highlights must reference known source bullet IDs.")
        if source_id in seen:
            raise ValueError("Each source bullet may be assigned or unassigned only once.")
        seen.add(source_id)

    def reconstruct(self, output: ResumeImportExtraction) -> ParsedResume:
        """Return the public schema in source order, copying bullet text and context locally."""
        self.validate(output)
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
            for reference in sorted(
                output.unassigned_highlights, key=lambda item: order[item.source_id]
            )
        ]
        return ParsedResume(**fields)
