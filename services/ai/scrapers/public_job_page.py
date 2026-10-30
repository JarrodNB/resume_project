"""Select one public posting's embedded job data or visible article/main content.

Never execute scripts or follow linked resources. Structured job data must identify
one posting; unstructured content is passed to the source-checked job parser,
which must identify an actual single job rather than a home/search/login page.
"""

import json

import httpx
from bs4 import BeautifulSoup

from scrapers.fetch_public_job import fetch_public_job_html
from scrapers.job_page import JobPage, JobPageUnreadableError


def _job_objects(value):
    if isinstance(value, list):
        for item in value:
            yield from _job_objects(item)
    elif isinstance(value, dict):
        types = value.get("@type", [])
        if "JobPosting" in (types if isinstance(types, list) else [types]):
            yield value
        if "@graph" in value:
            yield from _job_objects(value["@graph"])


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def public_job_html_to_page(html: str, url: str) -> JobPage:
    """Prefer exactly one JobPosting; otherwise select visible job-page content."""
    soup = BeautifulSoup(html, "html.parser")
    jobs = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            jobs.extend(_job_objects(json.loads(script.string or script.get_text())))
        except (ValueError, RecursionError):
            continue
    # Identical metadata can be repeated in page templates; distinct postings
    # indicate a listing page and must not silently become the first job.
    jobs = list({json.dumps(job, sort_keys=True): job for job in jobs}.values())
    if len(jobs) > 1:
        raise JobPageUnreadableError("Open one specific job, rather than a list of openings")
    if jobs:
        job = jobs[0]
        title, description = _text(job.get("title")), _text(job.get("description"))
        if title and description:
            organization = job.get("hiringOrganization")
            company = _text(organization.get("name")) if isinstance(organization, dict) else ""
            locations = job.get("jobLocation")
            if isinstance(locations, list):
                locations = locations[0] if len(locations) == 1 else None
            address = locations.get("address") if isinstance(locations, dict) else None
            location = ", ".join(_text(address.get(key)) for key in (
                "addressLocality", "addressRegion", "addressCountry",
            ) if _text(address.get(key))) if isinstance(address, dict) else ""
            if not location and job.get("jobLocationType") == "TELECOMMUTE":
                location = "Remote"
            return JobPage("website", url, title, company, location or None, description)
    if soup.select_one('input[type="password"]'):
        raise JobPageUnreadableError("This page requires login; paste the job ad instead")
    for element in soup.select("script, style, template, noscript, nav, footer, aside, form, iframe, [hidden], [aria-hidden='true']"):
        element.decompose()
    content = (soup.select_one("main") or soup.select_one("[role='main']")
               or soup.select_one("article") or soup.body or soup)
    if not content.get_text(" ", strip=True):
        raise JobPageUnreadableError("The page has no readable job ad; paste the ad instead")
    return JobPage("website", url, "", "", None, str(content), metadata_is_authoritative=False)


def scrape_public_job(url: str, client: httpx.Client) -> JobPage:
    """Fetch a public job page and select content without assuming a supported site."""
    return public_job_html_to_page(fetch_public_job_html(url, client), url)
