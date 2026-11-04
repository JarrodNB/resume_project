"""Measure a finished resume against the applicant's own career record and the job.

The outcome eval compares resume versions of one person. This module holds the parts that
need no model: the untailored comparison resume, plain-text rendering, and countable checks
such as false claims, invented numbers, retained results, role order and length.
None of this predicts hiring; a real recruiter or a real callback rate is still the ground truth.
"""

import re
from datetime import date
from difflib import SequenceMatcher

from pydantic import BaseModel, Field, model_validator

from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext, JobToAnalyze

# A resume over this is unlikely to fit two pages in the current renderer's dense layout.
TWO_PAGE_WORD_LIMIT = 1000
LONG_BULLET_WORDS = 35
VERBATIM_RATIO = 0.9
NUMBER = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?")
YEAR = re.compile(r"^(19|20)\d\d$")
# Phrases a good resume writer would not leave on the page. A signal for reading, not a score of quality.
WEAK_PHRASE = re.compile(
    r"contributed to work|work during which|coincided with|responsible for|helped with|results-driven|passionate|"
    r"\bha(?:s|ve) not\b|no (?:direct |hands-on |professional )?experience|sources?;|listed sources", re.IGNORECASE)


class OutcomeCase(BaseModel):
    """One applicant and one real-looking job. Hand-written YAML may omit record ids."""

    full_name: str
    job: JobToAnalyze
    library: CareerLibrary

    @model_validator(mode="before")
    @classmethod
    def assign_ids(cls, values: dict) -> dict:
        """Give records the stable ids production reads from Postgres."""
        values = {**values, "job": {"id": "job-1", **values["job"]}, "library": dict(values["library"])}
        library = values["library"]
        for key, prefix in (("experiences", "exp"), ("projects", "proj"), ("educations", "edu"),
                            ("certifications", "cert"), ("skills", "skill")):
            library[key] = [{"id": f"{prefix}-{number}", **row} for number, row in enumerate(library.get(key, []), 1)]
        count = 0
        for row in library["experiences"]:
            highlights = []
            for text in row.get("highlights", []):
                count += 1
                highlights.append({"id": f"hl-{count}", "content": text})
            row["highlights"] = highlights
        return values

    @property
    def context(self) -> GapAnalysisContext:
        return GapAnalysisContext(job=self.job, career_library=self.library)


class SupportedRequirement(BaseModel):
    """A job need the library backs, and words that would show it on the page."""

    requirement: str
    any_of: list[str]


class HiddenFact(BaseModel):
    """A true fact missing from the library, and words that show it reached the resume."""

    fact: str
    markers: list[str]


class OutcomeLabels(BaseModel):
    supported: list[SupportedRequirement] = Field(default_factory=list)
    traps: list[str] = Field(default_factory=list)
    notes: str = ""
    hidden_facts: list[HiddenFact] = Field(default_factory=list)


def _month(value: date | None) -> str | None:
    return value.strftime("%Y-%m") if value else None


def generic_resume_sections(case: OutcomeCase) -> list[dict]:
    """The resume this person already has: everything in the library, newest role first, unchanged."""
    library = case.library
    sections = [{"section_type": "contact", "content": {"full_name": case.full_name}}]
    if library.summary:
        sections.append({"section_type": "summary", "content": {"text": library.summary}})
    roles = sorted(library.experiences, key=lambda role: role.start_date or date.min, reverse=True)
    sections.append({"section_type": "experience", "content": {"items": [{
        "company": role.company, "title": role.title, "start_date": _month(role.start_date),
        "end_date": _month(role.end_date), "is_current": role.end_date is None,
        "highlights": [*([role.description] if role.description else []), *(item.content for item in role.highlights)],
    } for role in roles]}})
    if library.projects:
        sections.append({"section_type": "projects", "content": {"items": [
            {"name": project.name, "description": project.description} for project in library.projects]}})
    if library.educations:
        sections.append({"section_type": "education", "content": {"items": [
            {"institution": row.institution, "degree": row.degree, "field_of_study": row.field_of_study,
             "description": row.description, "end_date": _month(row.end_date)} for row in library.educations]}})
    if library.certifications:
        sections.append({"section_type": "certifications", "content": {"items": [
            {"name": row.name, "issuer": row.issuer, "expiry_date": _month(row.expiry_date)}
            for row in library.certifications]}})
    if library.skills:
        sections.append({"section_type": "skills", "content": {"items": [{"name": row.name} for row in library.skills]}})
    return sections


def _section(sections: list[dict], kind: str) -> dict | None:
    return next((section["content"] for section in sections if section["section_type"] == kind), None)


def render_resume(sections: list[dict]) -> str:
    """The resume as a reader sees it, in section order, with no field names or JSON."""
    lines = []
    for section in sections:
        kind, content = section["section_type"], section["content"]
        if kind == "contact":
            lines.append(content.get("full_name") or "")
        elif kind == "summary":
            lines += ["", "SUMMARY", content.get("text") or ""]
        elif kind == "experience":
            lines += ["", "EXPERIENCE"]
            for item in content["items"]:
                end = "Present" if item.get("is_current") else item.get("end_date") or ""
                lines.append(f"{item['title']}, {item['company']} ({item.get('start_date') or ''} to {end})")
                lines += [f"- {bullet}" for bullet in item.get("highlights") or []]
        elif kind == "projects":
            lines += ["", "PROJECTS"]
            lines += [f"{item['name']}: {item.get('description') or ''}" for item in content["items"]]
        elif kind == "education":
            lines += ["", "EDUCATION"]
            for item in content["items"]:
                parts = [item.get("degree"), item.get("field_of_study"), item.get("institution"), item.get("end_date")]
                lines.append(", ".join(part for part in parts if part))
                if item.get("description"):
                    lines.append(item["description"])
        elif kind == "certifications":
            lines += ["", "CERTIFICATIONS"]
            for item in content["items"]:
                parts = [item.get("name"), item.get("issuer")]
                expiry = item.get("expiry_date") or item.get("expiration_date")
                lines.append(", ".join(part for part in parts if part) + (f" (expires {expiry})" if expiry else ""))
        elif kind == "skills":
            lines += ["", "SKILLS", ", ".join(item["name"] for item in content["items"])]
    return "\n".join(lines).strip()


def render_job(job: JobToAnalyze) -> str:
    """The complete posting a recruiter or applicant would read."""
    lines = [f"{job.title} at {job.company or 'Unknown company'}"]
    for heading, items in (("Responsibilities", job.responsibilities), ("Requirements", job.requirements),
                           ("Nice to have", job.nice_to_haves)):
        if items:
            lines += ["", f"{heading}:", *[f"- {item}" for item in items]]
    return "\n".join(lines)


def render_library(library: CareerLibrary) -> str:
    """Every fact the applicant has recorded, for checking claims."""
    lines = []
    if library.summary:
        lines.append(f"Summary: {library.summary}")
    for role in library.experiences:
        lines.append(f"{role.title} at {role.company}, {_month(role.start_date)} to {_month(role.end_date) or 'present'}")
        if role.description:
            lines.append(f"- {role.description}")
        lines += [f"- {item.content}" for item in role.highlights]
    for project in library.projects:
        lines.append(f"Project {project.name}: {project.description or ''}")
    for row in library.educations:
        parts = [row.degree, row.field_of_study, row.institution, _month(row.end_date), row.description]
        lines.append("Education: " + ", ".join(part for part in parts if part))
    for row in library.certifications:
        lines.append(f"Certification: {row.name}, {row.issuer or ''}, issued {_month(row.issued_date)}, "
                     f"expires {_month(row.expiry_date) or 'not stated'}")
    if library.skills:
        lines.append("Skills: " + ", ".join(row.name for row in library.skills))
    return "\n".join(lines)


def prose_items(sections: list[dict]) -> list[str]:
    """Every sentence the writer controls: the summary, bullets and project descriptions."""
    items = []
    summary = _section(sections, "summary")
    if summary and summary.get("text"):
        items.append(summary["text"])
    experience = _section(sections, "experience")
    for role in (experience or {}).get("items", []):
        items += list(role.get("highlights") or [])
    projects = _section(sections, "projects")
    items += [item["description"] for item in (projects or {}).get("items", []) if item.get("description")]
    return items


def _numbers(text: str) -> set[str]:
    return {match.replace(",", "") for match in NUMBER.findall(text)}


def _has_term(term: str, text: str) -> bool:
    """Whole-word match, so a trap such as ARR does not fire on 'arrived'. A final * matches any ending."""
    term = term.strip()
    ending = "" if term.endswith("*") else r"(?!\w)"
    return re.search(rf"(?<!\w){re.escape(term.removesuffix('*'))}{ending}", text, re.IGNORECASE) is not None


def _is_chronological(sections: list[dict]) -> bool:
    """Newest role first, which is what a reader scanning a career expects."""
    items = (_section(sections, "experience") or {}).get("items", [])
    starts = [item["start_date"] for item in items if item.get("start_date")]
    return starts == sorted(starts, reverse=True)


def measure_resume(sections: list[dict], *, truth: str, library: CareerLibrary, job: JobToAnalyze,
                   labels: OutcomeLabels) -> dict:
    """Countable facts about one resume. `truth` is everything this version was allowed to know."""
    text = render_resume(sections)
    prose = prose_items(sections)
    prose_text = "\n".join(prose)
    experience = (_section(sections, "experience") or {}).get("items", [])
    bullets = [bullet for role in experience for bullet in role.get("highlights") or []]
    sources = [item.content for role in library.experiences for item in role.highlights]
    source_numbers = {number for number in _numbers(" ".join(sources)) if not YEAR.match(number)}
    verbatim = [bullet for bullet in bullets if any(
        SequenceMatcher(None, bullet.lower().rstrip("."), source.lower()).ratio() >= VERBATIM_RATIO for source in sources)]
    return {
        "requirement_coverage": _share([any(_has_term(term, text) for term in row.any_of) for row in labels.supported]),
        "false_claim_terms": [term for term in labels.traps if _has_term(term, prose_text)],
        "invented_numbers": sorted(_numbers(prose_text) - _numbers(truth) - _numbers(render_job(job))),
        "job_numbers_used": sorted((_numbers(prose_text) & _numbers(render_job(job))) - _numbers(truth)),
        "result_retention": _share([number in _numbers(text) for number in source_numbers]),
        "hidden_fact_recall": _share([any(_has_term(marker, text) for marker in row.markers) for row in labels.hidden_facts]),
        "chronological": _is_chronological(sections),
        "words": len(text.split()),
        "over_two_pages": len(text.split()) > TWO_PAGE_WORD_LIMIT,
        "bullets": len(bullets),
        "roles": len(experience),
        "roles_without_bullets": sum(not role.get("highlights") for role in experience),
        "long_bullet_share": _share([len(bullet.split()) > LONG_BULLET_WORDS for bullet in bullets]),
        "verbatim_share": _share([bullet in verbatim for bullet in bullets]),
        "skills": len((_section(sections, "skills") or {}).get("items", [])),
    }


def weak_phrases(resume: str) -> list[str]:
    """Every weak phrase found in a rendered resume, so saved versions can be compared too."""
    return [match.group(0).lower() for match in WEAK_PHRASE.finditer(resume)]


def bullet_overlap(first: list[dict], second: list[dict]) -> float:
    """How much two versions share, from 0 to 1, to show how much a rerun changes."""
    left, right = set(prose_items(first)), set(prose_items(second))
    return len(left & right) / len(left | right) if left | right else 1.0


def _share(flags: list[bool]) -> float | None:
    return sum(flags) / len(flags) if flags else None
