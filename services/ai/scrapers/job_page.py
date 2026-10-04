"""
Description: What every job site scraper returns: the posting's fields as the site states them,
with the description still as HTML (split into sections later by job_postings/).
Index:
    - JobPage: one scraped job posting
    - UnsupportedJobUrlError: the URL isn't a job posting on a supported site
    - JobPostingNotFoundError: the site says the posting doesn't exist (closed or removed)
    - JobPageUnreadableError: the site answered, but not with a job posting we can read
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class JobPage:
    """A job posting exactly as the site returned it."""

    source: str
    source_url: str
    title: str
    company: str
    location: str | None
    description_html: str


class UnsupportedJobUrlError(Exception):
    """The URL isn't a job posting on a site we can scrape."""


class JobPostingNotFoundError(Exception):
    """The site has no posting at this URL (it may have closed)."""


class JobPageUnreadableError(Exception):
    """The page is missing the posting's fields (a login wall or a changed layout)."""
