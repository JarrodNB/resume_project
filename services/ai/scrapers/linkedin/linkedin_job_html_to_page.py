"""
Description: Reads a LinkedIn guest job page into a JobPage, and the scraper entry point that
ties URL parsing, fetching, and reading together.
Index:
    - linkedin_job_html_to_page: JobPage from the page's top card and description markup
    - scrape_linkedin_job: URL -> JobPage; raises UnsupportedJobUrlError for other URLs
"""

import re

import httpx
from bs4 import BeautifulSoup, Tag

from scrapers.job_page import JobPage, JobPageUnreadableError, UnsupportedJobUrlError
from scrapers.linkedin.fetch_linkedin_job import fetch_linkedin_job_html
from scrapers.linkedin.linkedin_description_to_html import linkedin_description_to_html
from scrapers.linkedin.parse_linkedin_job_url import linkedin_job_url, parse_linkedin_job_id

SOURCE_NAME = "linkedin"
TITLE_SELECTOR = ".top-card-layout__title, .topcard__title"
COMPANY_SELECTORS = (".topcard__org-name-link", ".topcard__flavor")
LOCATION_SELECTOR = ".topcard__flavor.topcard__flavor--bullet"
DESCRIPTION_SELECTORS = (".show-more-less-html__markup", ".description__text")
WHITESPACE = re.compile(r"\s+")


def linkedin_job_html_to_page(page_html: str, job_id: str) -> JobPage:
    """Raises JobPageUnreadableError when the page has no job title (a login wall or a
    changed layout), so a broken page never becomes an empty job."""
    soup = BeautifulSoup(page_html, "html.parser")
    title = _text(soup.select_one(TITLE_SELECTOR))
    if not title:
        raise JobPageUnreadableError(linkedin_job_url(job_id))
    description = _first_match(soup, DESCRIPTION_SELECTORS)
    return JobPage(
        source=SOURCE_NAME,
        source_url=linkedin_job_url(job_id),
        title=title,
        company=_text(_first_match(soup, COMPANY_SELECTORS)),
        location=_text(soup.select_one(LOCATION_SELECTOR)) or None,
        description_html=(
            linkedin_description_to_html(description.decode_contents()) if description else ""
        ),
    )


def scrape_linkedin_job(url: str, http_client: httpx.Client) -> JobPage:
    """Fetches and reads the job at a LinkedIn job link."""
    job_id = parse_linkedin_job_id(url)
    if job_id is None:
        raise UnsupportedJobUrlError(url)
    return linkedin_job_html_to_page(fetch_linkedin_job_html(job_id, http_client), job_id)


def _first_match(soup: BeautifulSoup, selectors: tuple[str, ...]) -> Tag | None:
    """The first element matching any selector, trying them in order."""
    return next((tag for selector in selectors if (tag := soup.select_one(selector))), None)


def _text(element: Tag | None) -> str:
    """The element's text with whitespace collapsed, or "" when it's missing."""
    return WHITESPACE.sub(" ", element.get_text(" ")).strip() if element else ""
