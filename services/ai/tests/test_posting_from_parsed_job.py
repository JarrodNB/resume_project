"""
Description: Tests for checking a parsed job ad against the paste and building the posting
Rails saves. No model calls.
Index:
    - test_*: one behavior per test
"""

from job_postings.find_parsed_job_problems import find_parsed_job_problems
from job_postings.posting_from_parsed_job import (
    DROPPED_LOCATION_WARNING,
    DROPPED_URL_WARNING,
    NO_REQUIREMENTS_WARNING,
    posting_from_parsed_job,
)
from schemas.parsed_job_posting import ParsedJobPosting

AD = """\
AI Engineer
Acme
Remote
https://example.com/jobs/1

Responsibilities
- Build agents

Requirements
- 5 years of Python
- Experience with PostgreSQL

Nice to have
- Familiarity with Rust
"""


def _parsed(**overrides: object) -> ParsedJobPosting:
    """A faithful parse of AD, with any field replaced."""
    fields = {
        "title": "AI Engineer",
        "company": "Acme",
        "location": "Remote",
        "url": "https://example.com/jobs/1",
        "requirements": ["5 years of Python", "Experience with PostgreSQL"],
        "responsibilities": ["Build agents"],
        "nice_to_haves": ["Familiarity with Rust"],
    }
    fields.update(overrides)
    return ParsedJobPosting.model_validate(fields)


def test_a_faithful_parse_has_no_problems() -> None:
    """Title, company, and bullets copied from the ad are accepted."""
    assert find_parsed_job_problems(_parsed(), AD) == []


def test_a_title_missing_from_the_ad_is_rejected() -> None:
    """An invented title is sent back to the model."""
    problems = find_parsed_job_problems(_parsed(title="Staff Wizard"), AD)

    assert problems == ["title must be copied from the advertisement"]


def test_an_invented_bullet_is_rejected() -> None:
    """A requirement that is not in the ad is sent back to the model."""
    problems = find_parsed_job_problems(_parsed(requirements=["10 years of COBOL"]), AD)

    assert any("requirements item 1" in problem for problem in problems)


def test_an_invented_responsibility_is_rejected() -> None:
    """A duty that is not in the ad is sent back to the model."""
    problems = find_parsed_job_problems(_parsed(responsibilities=["Invent a new database"]), AD)

    assert any("responsibilities item 1" in problem for problem in problems)


def test_posting_keeps_the_paste_as_the_description() -> None:
    """The saved description is the ad, and the link is the one copied from it."""
    posting = posting_from_parsed_job(AD, _parsed())

    assert posting.source == "pasted_text"
    assert posting.description == AD.strip()
    assert posting.source_url == "https://example.com/jobs/1"
    assert posting.requirements == ["5 years of Python", "Experience with PostgreSQL"]
    assert posting.responsibilities == ["Build agents"]
    assert posting.requirements_sorted_by == "llm"
    assert posting.warnings == []


def test_location_and_url_missing_from_the_ad_are_dropped() -> None:
    """Optional fields the model invented are left off, with a warning each."""
    posting = posting_from_parsed_job(
        AD, _parsed(location="Atlantis", url="https://invented.example/job")
    )

    assert posting.location is None
    assert posting.source_url == ""
    assert DROPPED_LOCATION_WARNING in posting.warnings
    assert DROPPED_URL_WARNING in posting.warnings


def test_no_requirements_adds_a_warning() -> None:
    """A prose ad can still become a job, and the user is told to add requirements."""
    posting = posting_from_parsed_job(
        AD, _parsed(requirements=[], responsibilities=[], nice_to_haves=[])
    )

    assert posting.requirements == []
    assert posting.requirements_sorted_by == "none"
    assert posting.warnings == [NO_REQUIREMENTS_WARNING]
