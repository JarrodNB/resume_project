"""Keep experience source passages and their model-selected IDs together.

Each instance belongs to one screened resume. It labels eligible passages, validates
model selections for retry, and rebuilds exact highlights without exposing its source map.
The caller still owns prompt fencing and generation.
"""

import re

from pydantic import create_model, model_validator

from schemas.parsed_resume import ExperienceExtraction, ExperienceRoleExtraction

_BULLET_LINE = re.compile(r"^\s*(?:[•●▪◦‣⁃✓*+\-–—]|\d+[.)])\s+(.*)$")
_DATE_LINE = re.compile(
    r"^(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?"
    r"(?:\d{1,2}/)?(?:19|20)\d{2}(?:[-/]\d{1,2})?\s*[-–—]\s*"
    r"(?:(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?"
    r"(?:\d{1,2}/)?(?:19|20)\d{2}(?:[-/]\d{1,2})?|present|current)\.?$",
    re.IGNORECASE,
)
_DATE_PART = (
    r"(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?"
    r"(?:\d{1,2}/)?(?:19|20)\d{2}(?:[-/]\d{1,2})?"
)
_DATE_RANGE_SUFFIX = re.compile(
    rf"{_DATE_PART}\s*[-–—]\s*(?:{_DATE_PART}|present|current)\.?$",
    re.IGNORECASE,
)
_ROLE_HEADER_SEPARATOR = re.compile(r",\s+|\s+[|–—-]\s+|\s+at\s+", re.IGNORECASE)
_SECTION_HEADINGS = {
    "summary", "professional summary", "career summary", "objective", "career objective",
    "profile", "experience", "work experience", "work history",
    "professional experience", "professional history", "career experience", "career history",
    "employment", "employment history", "education", "skills", "technical skills",
    "core competencies", "competencies", "projects", "personal projects",
    "side projects", "selected projects", "academic projects", "open source projects",
    "open-source projects", "project experience", "selected builds",
    "certifications", "credentials", "training", "toolbox", "awards", "honors",
    "publications", "languages", "interests", "volunteer experience",
}
_EXPERIENCE_HEADINGS = {
    "experience", "work experience", "work history", "professional experience",
    "professional history", "career experience", "career history", "employment", "employment history",
    "volunteer experience",
}
_DATE_EXCLUDED_SECTION_HEADINGS = {
    "education", "skills", "technical skills", "core competencies", "competencies",
    "projects", "personal projects", "side projects", "selected projects", "academic projects",
    "open source projects", "open-source projects", "project experience", "selected builds",
    "certifications", "credentials",
    "training", "toolbox", "awards", "honors", "publications", "languages", "interests",
}


def _section_kind(line: str) -> str | None:
    """Tell work history headings from sections whose bullets are not job highlights."""
    heading = line.strip().rstrip(": ").casefold()
    if heading in _EXPERIENCE_HEADINGS:
        return "experience"
    if heading in _SECTION_HEADINGS:
        return "other"
    return None


def _looks_like_title_case_label(text: str, *, minimum_words: int = 1) -> bool:
    """Recognize compact title/company lines without treating sentence fragments as headers."""
    words = re.findall(r"[A-Za-z][A-Za-z&.'’/-]*", text)
    connector_words = {"and", "at", "for", "of", "the", "to"}
    return (
        minimum_words <= len(words) <= 8
        and all(word[0].isupper() or word.casefold() in connector_words for word in words)
    )


def _is_role_date_header(line: str) -> bool:
    """Recognize standalone dates or role-shaped headers that end with a date range."""
    text = line.strip()
    if _DATE_LINE.fullmatch(text):
        return True
    match = _DATE_RANGE_SUFFIX.search(text)
    if not match or _BULLET_LINE.match(text):
        return False
    prefix = text[: match.start()].rstrip(" ,|–—-")
    parts = _ROLE_HEADER_SEPARATOR.split(prefix)
    return bool(prefix) and all(_looks_like_title_case_label(part) for part in parts)


def _is_resume_boundary(
    line: str, next_line: str, after_next_line: str = "", *, separated_after_sentence: bool = False,
) -> bool:
    """Recognize section headings and role/date headers between source bullets."""
    text = line.strip()
    if not text:
        return True
    if _section_kind(text):
        return True
    # A standalone label after a completed paragraph can start a new role/section.
    # Within unfinished prose the same capitalization may simply be "AWS SQS".
    if (
        separated_after_sentence and len(text) <= 60
        and _looks_like_title_case_label(text)
        and not text.endswith((".", "!", "?"))
    ):
        return True
    if _DATE_LINE.fullmatch(text):
        return True
    if len(text) <= 120 and _is_role_date_header(text):
        return True
    if len(text) <= 120 and not text.endswith((".", "!", "?")):
        role_parts = _ROLE_HEADER_SEPARATOR.split(text)
        if len(role_parts) > 1 and all(
            part.strip() and part.strip()[0].isupper() for part in role_parts
        ):
            return True
        if (
            _looks_like_title_case_label(text, minimum_words=2)
            and _looks_like_title_case_label(next_line)
            and (
                _DATE_LINE.fullmatch(after_next_line.strip())
                or _BULLET_LINE.match(after_next_line)
            )
        ):
            return True
    return bool(len(text) <= 120 and _DATE_LINE.fullmatch(next_line.strip()))


def _source_bullet_map(resume_text: str) -> tuple[dict[str, str], dict[int, str]]:
    """Keep visible bullet text across wraps and empty extraction/page separators.

    Empty lines carry no ownership information. Use the next nonempty lines to
    identify real headers; capitalization alone can also be an acronym continuation.
    """
    bullets: dict[str, str] = {}
    bullet_lines: dict[int, str] = {}
    current_id = None
    current_lines: list[str] = []
    lines = resume_text.splitlines()
    has_experience_heading = any(_section_kind(line) == "experience" for line in lines)
    has_date_header = any(_is_role_date_header(line) for line in lines)
    in_experience_section = not has_experience_heading and not has_date_header
    in_date_excluded_section = False

    def save():
        if current_id is not None:
            bullets[current_id] = "\n".join(current_lines)

    nonempty_lines = [(index, line) for index, line in enumerate(lines) if line.strip()]
    for position, (index, line) in enumerate(nonempty_lines):
        section = _section_kind(line)
        if section:
            save()
            current_id, current_lines = None, []
            in_experience_section = section == "experience"
            heading = line.strip().rstrip(": ").casefold()
            in_date_excluded_section = heading in _DATE_EXCLUDED_SECTION_HEADINGS
            continue
        if not has_experience_heading and not in_date_excluded_section and (
            _is_role_date_header(line)
        ):
            save()
            current_id, current_lines = None, []
            in_experience_section = True
            continue
        match = _BULLET_LINE.match(line)
        if match:
            save()
            if in_experience_section:
                current_id = f"B{len(bullets) + 1}"
                current_lines = [match.group(1)]
                bullet_lines[index] = current_id
            else:
                current_id, current_lines = None, []
        elif current_id is not None and line.strip() and not _is_resume_boundary(
            line,
            nonempty_lines[position + 1][1] if position + 1 < len(nonempty_lines) else "",
            nonempty_lines[position + 2][1] if position + 2 < len(nonempty_lines) else "",
            separated_after_sentence=(
                index > nonempty_lines[position - 1][0] + 1
                and current_lines[-1].rstrip().endswith((".", "!", "?"))
            ),
        ):
            current_lines.append(line.strip())
        elif current_id is not None:
            save()
            current_id, current_lines = None, []
    save()
    return bullets, bullet_lines



class ExperienceSource:
    """Own source annotation, valid selections, and exact experience reconstruction."""

    def __init__(self, resume_text: str):
        self._bullets, bullet_lines = _source_bullet_map(resume_text)
        self._bullet_order = {bullet_id: index for index, bullet_id in enumerate(self._bullets)}
        lines = resume_text.splitlines()
        for line_index, bullet_id in bullet_lines.items():
            line = lines[line_index]
            match = _BULLET_LINE.match(line)
            lines[line_index] = f"{line[:match.start()]}[{bullet_id}] {line[match.start():]}"
        self.annotated_text = "\n".join(lines)

        def validate_ids(output):
            self._validate_ids(output)
            return output

        validator = model_validator(mode="after")(validate_ids)
        self.output_type = create_model(
            "ValidatedExperienceExtraction",
            __base__=ExperienceExtraction,
            __validators__={"validate_source_bullet_ids": validator},
        )
        self.output_type.model_rebuild(
            _types_namespace={"ExperienceRoleExtraction": ExperienceRoleExtraction}
        )

    def _validate_ids(self, output: ExperienceExtraction) -> None:
        seen = set()
        for role in output.experiences:
            for bullet_id in role.highlight_ids:
                if bullet_id not in self._bullets or bullet_id in seen:
                    raise ValueError("Use only known source bullet IDs, once per resume.")
                seen.add(bullet_id)

    def reconstruct(self, output: ExperienceExtraction) -> dict:
        """Return parsed fields with each role's exact highlights in source order.

        Validate again using the same rule so callers cannot bypass ID safety by
        constructing an unvalidated output. Metadata and warnings pass through unchanged.
        """
        self._validate_ids(output)
        values = output.model_dump()
        for role in values["experiences"]:
            bullet_ids = role.pop("highlight_ids")
            role["highlights"] = [
                self._bullets[bullet_id]
                for bullet_id in sorted(bullet_ids, key=self._bullet_order.__getitem__)
            ]
        return values
