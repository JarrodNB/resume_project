"""
Description: Tests for checking a parsed job ad against the paste and building the posting
Rails saves. No model calls.
Index:
    - test_*: one behavior per test
"""

import pytest

from job_postings.find_parsed_job_problems import find_parsed_job_problems
from job_postings.posting_from_parsed_job import (
    DROPPED_LOCATION_WARNING,
    DROPPED_URL_WARNING,
    NO_REQUIREMENTS_WARNING,
    posting_from_parsed_job,
)
from schemas.parsed_job_posting import ParsedJobPosting
from text_limits import MAX_SHORT_TEXT, POSTING_LEFT_OUT_WARNING

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


def test_null_company_stays_null_in_posting() -> None:
    """An unnamed employer stays absent through conversion and saved-length fitting."""
    text = AD.replace("Acme\n", "")
    parsed = _parsed(company=None)
    assert find_parsed_job_problems(parsed, text) == []
    assert posting_from_parsed_job(text, parsed).model_dump()["company"] is None


def test_invented_company_is_rejected() -> None:
    """Optional companies still need evidence when supplied."""
    assert find_parsed_job_problems(_parsed(company="Invented Ltd"), AD) == [
        "company must be copied from the advertisement"
    ]


def test_blank_title_is_rejected_even_without_company() -> None:
    """A nullable company does not relax the required title."""
    assert find_parsed_job_problems(_parsed(title="", company=None), AD) == [
        "title must be copied from the advertisement"
    ]


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


def test_duplicate_bullets_collapse_by_normalized_text_and_keep_first_spelling() -> None:
    """Repeated case/spacing variants and blank lines don't duplicate saved evidence."""
    posting = posting_from_parsed_job(
        AD,
        _parsed(requirements=["  Python experience ", "python   EXPERIENCE", "", "PostgreSQL"]),
    )

    assert posting.requirements == ["Python experience", "PostgreSQL"]


@pytest.mark.parametrize("extra_characters", [0, 1])
def test_pasted_url_respects_saved_length_without_truncating(extra_characters: int) -> None:
    """A long optional link must not prevent saving the rest of a faithful posting."""
    prefix = "https://example.com/jobs/"
    url = prefix + "a" * (MAX_SHORT_TEXT - len(prefix) + extra_characters)
    source = AD.replace("https://example.com/jobs/1", url)

    posting = posting_from_parsed_job(source, _parsed(url=url))

    assert posting.source_url == ("" if extra_characters else url)
    assert (POSTING_LEFT_OUT_WARNING in posting.warnings) == bool(extra_characters)
    assert posting.title == "AI Engineer"
    assert posting.requirements == ["5 years of Python", "Experience with PostgreSQL"]


@pytest.mark.parametrize("altered_url", [
    "https://example.com/jobs/abc123?token=Secret",
    "https://example.com/jobs/AbC123?token=secret",
])
def test_pasted_url_must_preserve_source_path_and_query_case(altered_url: str) -> None:
    """Prose normalization must not turn an altered link into accepted source evidence."""
    source_url = "https://example.com/jobs/AbC123?token=Secret"
    source = AD.replace("https://example.com/jobs/1", source_url)

    posting = posting_from_parsed_job(source, _parsed(url=altered_url))

    assert posting.source_url == ""
    assert posting.warnings == [DROPPED_URL_WARNING]


def test_exactly_copied_mixed_case_url_is_preserved() -> None:
    """Optional link checking leaves a valid source destination unchanged."""
    url = "https://example.com/jobs/AbC123?token=Secret"
    source = AD.replace("https://example.com/jobs/1", url)

    posting = posting_from_parsed_job(source, _parsed(url=url))

    assert posting.source_url == url
    assert posting.warnings == []
