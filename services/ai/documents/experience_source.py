"""Keep experience source passages and their model-selected IDs together.

Each instance belongs to one screened resume. It labels eligible passages, validates
model selections for retry, and rebuilds exact highlights without exposing its source map.
The caller still owns prompt fencing and generation.
"""

import re

from pydantic import create_model, model_validator

from documents.text_matching import normalize_text
from schemas.parsed_resume import ExperienceExtraction, ExperienceRoleExtraction

_SHARED_LIST_HEADER = re.compile(
    r"shared (?:accomplishments|achievements|highlights|responsibilities)(?: across (?:both|all) roles)?[: ]*",
    re.IGNORECASE,
)
_BULLET_LINE = re.compile(r"^\s*(?:[•●▪◦‣⁃✓*+\-–—]|\d+[.)])\s+(.*)$")
_DATE_LINE = re.compile(
    r"^(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?"
    r"(?:\d{1,2}/)?(?:19|20)\d{2}(?:[-/]\d{1,2})?\s*(?:[-–—]|to)\s*"
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
    rf"{_DATE_PART}\s*(?:[-–—]|to)\s*(?:{_DATE_PART}|present|current)\)?\.?$",
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
    words = re.findall(r"[A-Za-z][A-Za-z&.'’/-]*", re.sub(r"«pii:[^»]+»", "Private", text))
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
    prefix = text[: match.start()].rstrip(" ,|–—-(")
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
    if _SHARED_LIST_HEADER.fullmatch(text):
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
        self._nonempty = [(index, line) for index, line in enumerate(lines) if line.strip()]
        self._bullet_positions = {bullet_id: index for index, bullet_id in bullet_lines.items()}
        self._explicit_shared_ids = set()
        in_shared_list = False
        for position, (index, line) in enumerate(self._nonempty):
            following = [value for _, value in self._nonempty[position + 1:position + 3]]
            if _SHARED_LIST_HEADER.fullmatch(line.strip()):
                in_shared_list = True
            elif not _BULLET_LINE.match(line) and _is_resume_boundary(
                line, following[0] if following else "", following[1] if len(following) > 1 else "",
            ):
                in_shared_list = False
            if in_shared_list and index in bullet_lines:
                self._explicit_shared_ids.add(bullet_lines[index])
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
        for entry in output.experiences:
            scopes = [entry.shared_highlight_ids, *(role.highlight_ids for role in entry.roles)]
            for scope in scopes:
                for bullet_id in scope:
                    if bullet_id not in self._bullets or bullet_id in seen:
                        raise ValueError("Use only known source bullet IDs, once per resume.")
                    seen.add(bullet_id)
        self._validate_layout(output)

    def _company_heading_before(self, company: str, before: int) -> int | None:
        """Use only a literal employer heading, never a company mention inside prose."""
        for index, line in reversed(self._nonempty):
            if index >= before:
                continue
            if _section_kind(line) == "other":
                return None
            if _BULLET_LINE.match(line):
                continue
            parts = _ROLE_HEADER_SEPARATOR.split(line.strip())
            if normalize_text(line) == company or (normalize_text(parts[0]) == company and len(parts) > 1
                                                   and all(_looks_like_title_case_label(part) for part in parts[1:])):
                return index
        return None

    def _role_anchor(self, entry, role):
        """Recognize dated literal role headers; uncertain or repeated matches stay unbound."""
        title, company = normalize_text(role.title), normalize_text(entry.company)
        candidates = []
        for position, (index, line) in enumerate(self._nonempty):
            if _BULLET_LINE.match(line):
                continue
            date_suffix = _DATE_RANGE_SUFFIX.search(line.strip())
            following = self._nonempty[position + 1][1] if position + 1 < len(self._nonempty) else ""
            if not date_suffix and not _DATE_LINE.fullmatch(following.strip()):
                continue
            header = line.strip()[:date_suffix.start()].rstrip(" ,|–—-(") if date_suffix else line.strip()
            parts = [normalize_text(part) for part in _ROLE_HEADER_SEPARATOR.split(header)]
            if title in parts and company in parts and title != company:
                candidates.append((index, index))
            elif normalize_text(header) == title:
                employer = self._company_heading_before(company, index)
                if employer is not None:
                    candidates.append((index, employer))
        if role.highlight_ids:
            first_bullet = min(self._bullet_positions[bullet_id] for bullet_id in role.highlight_ids)
            preceding = [candidate for candidate in candidates if candidate[0] < first_bullet]
            return preceding[-1][1] if preceding else None
        return candidates[0][1] if len(candidates) == 1 else None

    def _validate_layout(self, output):
        """Retry contradictions of positive header evidence without guessing new layouts."""
        block_owners = {}
        bindings = []
        for entry_index, entry in enumerate(output.experiences):
            anchors = {anchor for role in entry.roles if (anchor := self._role_anchor(entry, role)) is not None}
            if len(anchors) > 1:
                raise ValueError("Keep separate source employment blocks as separate experiences.")
            for position in anchors:
                previous = block_owners.setdefault(position, entry_index)
                if previous != entry_index:
                    raise ValueError("Keep roles beneath a single company heading in one experience.")
            bindings.append((entry, anchors))
        for bullet_id in self._explicit_shared_ids:
            source_position = self._bullet_positions[bullet_id]
            for entry, anchors in bindings:
                employer = self._company_heading_before(normalize_text(entry.company), source_position)
                if employer in anchors and bullet_id not in entry.shared_highlight_ids:
                    raise ValueError("Include all explicitly shared source bullets once in their employment block's shared_highlight_ids.")

    def reconstruct(self, output: ExperienceExtraction) -> dict:
        """Return parsed fields with each role's exact highlights in source order.

        Validate again using the same rule so callers cannot bypass ID safety by
        constructing an unvalidated output. Metadata and warnings pass through unchanged.
        """
        self._validate_ids(output)
        values = output.model_dump()
        for entry in values["experiences"]:
            scopes = [(entry, "shared_highlight_ids", "shared_highlights")]
            scopes.extend((role, "highlight_ids", "highlights") for role in entry["roles"])
            for scope, ids_key, text_key in scopes:
                bullet_ids = scope.pop(ids_key)
                scope[text_key] = [
                    self._bullets[bullet_id]
                    for bullet_id in sorted(bullet_ids, key=self._bullet_order.__getitem__)
                ]
        return values
