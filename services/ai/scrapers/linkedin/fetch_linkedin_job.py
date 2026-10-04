"""
Description: Fetches one job's public page from LinkedIn's guest jobs endpoint (no login), the
HTML LinkedIn shows signed-out visitors.
Index:
    - fetch_linkedin_job_html: the page's HTML; raises JobPostingNotFoundError for a 404
"""

import httpx

from scrapers.job_page import JobPostingNotFoundError

GUEST_JOB_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"


def fetch_linkedin_job_html(job_id: str, http_client: httpx.Client) -> str:
    """GETs the guest job page. Other HTTP errors raise httpx.HTTPStatusError and network errors
    raise httpx.TransportError (retryable for 429, 5xx including LinkedIn's 999, and network)."""
    url = GUEST_JOB_URL.format(job_id=job_id)
    response = http_client.get(url)
    if response.status_code == httpx.codes.NOT_FOUND:
        raise JobPostingNotFoundError(url)
    response.raise_for_status()
    return response.text
