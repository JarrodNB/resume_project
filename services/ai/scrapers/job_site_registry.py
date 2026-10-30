"""
Description: The job sites we can scrape, and which one handles a given URL. Add one site at a
time: a matcher on its hosts plus a scrape function returning a JobPage.
Index:
    - JobSiteScraper: a site's name, host matcher, and scrape function
    - JOB_SITE_SCRAPERS: every supported site
    - find_job_site_scraper: the scraper for a URL, or None for an unsupported site
"""

from collections.abc import Callable
from dataclasses import dataclass

import httpx

from scrapers.job_page import JobPage
from scrapers.linkedin.linkedin_job_html_to_page import scrape_linkedin_job
from scrapers.linkedin.parse_linkedin_job_url import is_linkedin_url
from scrapers.public_job_page import scrape_public_job
from scrapers.public_job_url import public_job_url


@dataclass(frozen=True)
class JobSiteScraper:
    """Scrapes job postings from one site."""

    name: str
    matches_url: Callable[[str], bool]
    scrape: Callable[[str, httpx.Client], JobPage]


JOB_SITE_SCRAPERS = [
    JobSiteScraper(name="linkedin", matches_url=is_linkedin_url, scrape=scrape_linkedin_job),
]


def find_job_site_scraper(url: str) -> JobSiteScraper | None:
    """Returns the first scraper whose site hosts the URL."""
    from scrapers.job_page import UnsupportedJobUrlError

    try:
        public_job_url(url)
    except UnsupportedJobUrlError:
        return None
    return next((scraper for scraper in JOB_SITE_SCRAPERS if scraper.matches_url(url)),
                JobSiteScraper(name="website", matches_url=lambda _: True, scrape=scrape_public_job))
