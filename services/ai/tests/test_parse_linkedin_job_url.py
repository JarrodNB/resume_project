"""Check copied LinkedIn links and scraper selection, including malformed input."""

import pytest

from scrapers.job_site_registry import find_job_site_scraper
from scrapers.linkedin.parse_linkedin_job_url import (
    is_linkedin_url,
    linkedin_job_url,
    parse_linkedin_job_id,
)


@pytest.mark.parametrize(
    ("url", "job_id"),
    [
        ("https://www.linkedin.com/jobs/view/4419969671", "4419969671"),
        ("https://www.linkedin.com/jobs/view/4419969671/?refId=abc&trackingId=x", "4419969671"),
        (
            "https://www.linkedin.com/jobs/view/senior-engineer-go-at-general-motors-4419969671",
            "4419969671",
        ),
        ("https://uk.linkedin.com/jobs/view/data-engineer-at-fabrikam-123", "123"),
        ("https://www.linkedin.com/comm/jobs/view/4419969671/?trk=email", "4419969671"),
        ("https://www.linkedin.com/jobs/search/?currentJobId=456&keywords=ml", "456"),
        ("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=789", "789"),
        ("  HTTPS://LinkedIn.com/jobs/view/42  ", "42"),
    ],
)
def test_parses_supported_url_forms(url: str, job_id: str) -> None:
    """Every LinkedIn job link form people copy yields its job id."""
    assert parse_linkedin_job_id(url) == job_id


@pytest.mark.parametrize(
    "url",
    [
        "https://www.linkedin.com/jobs/",
        "https://www.linkedin.com/jobs/search/?keywords=ml",
        "https://www.linkedin.com/in/someone",
        "https://www.linkedin.com/feed/?currentJobId=1",
        "https://www.linkedin.com/jobs/view/not-a-number",
        "ftp://www.linkedin.com/jobs/view/1",
        "www.linkedin.com/jobs/view/1",
        "https://linkedin.com.evil.com/jobs/view/1",
    ],
)
def test_rejects_urls_that_are_not_one_job(url: str) -> None:
    """Pages that aren't a single job, and look-alike hosts, aren't parsed."""
    assert parse_linkedin_job_id(url) is None


def test_canonical_url_has_no_tracking() -> None:
    """The canonical link is the bare /jobs/view/{id}/ form."""
    assert linkedin_job_url("42") == "https://www.linkedin.com/jobs/view/42/"


@pytest.mark.parametrize(
    "url",
    [
        "https://[linkedin.com/jobs/view/1",
        "https://[not-an-ip]/jobs/view/1",
        "https://www.linkedin.com\uff0f.evil.com/jobs/view/1",
    ],
)
def test_malformed_urls_are_rejected(url: str) -> None:
    """Invalid authorities do not raise while inspecting pasted links."""
    assert not is_linkedin_url(url)
    assert parse_linkedin_job_id(url) is None
    assert find_job_site_scraper(url) is None


def test_registry_finds_linkedin_by_host() -> None:
    """LinkedIn hosts map to the LinkedIn scraper; other sites to none."""
    scraper = find_job_site_scraper("https://www.linkedin.com/jobs/view/1")

    assert scraper is not None and scraper.name == "linkedin"
    assert find_job_site_scraper("https://www.indeed.com/viewjob?jk=abc123") is None
    assert not is_linkedin_url("https://notlinkedin.com/jobs/view/1")
