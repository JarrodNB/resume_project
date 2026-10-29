"""
Description: Fetches one job's public page from LinkedIn's guest jobs endpoint (no login), the
HTML LinkedIn shows signed-out visitors. Reject redirects and compressed responses,
and bound response bytes before parsing so fetches stay on the public endpoint.
Index:
    - fetch_linkedin_job_html: the page's HTML; raises JobPostingNotFoundError for a 404
"""

import httpx

from scrapers.job_page import JobPageUnreadableError, JobPostingNotFoundError

MAX_JOB_PAGE_BYTES = 2 * 1024 * 1024

GUEST_JOB_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"


def fetch_linkedin_job_html(job_id: str, http_client: httpx.Client) -> str:
    """GETs the guest job page. Other HTTP errors raise httpx.HTTPStatusError and network errors
    raise httpx.TransportError (retryable for 429, 5xx including LinkedIn's 999, and network)."""
    url = GUEST_JOB_URL.format(job_id=job_id)
    with http_client.stream(
        "GET", url, headers={"Accept-Encoding": "identity"}, follow_redirects=False
    ) as response:
        if response.status_code == httpx.codes.NOT_FOUND:
            raise JobPostingNotFoundError(url)
        response.raise_for_status()
        if response.headers.get("content-encoding", "identity").lower() != "identity":
            raise JobPageUnreadableError("Compressed job pages are not supported")
        content = bytearray()
        for chunk in response.iter_bytes(chunk_size=64 * 1024):
            if len(content) + len(chunk) > MAX_JOB_PAGE_BYTES:
                raise JobPageUnreadableError("The job page is too large to read")
            content.extend(chunk)
        return content.decode(response.encoding or "utf-8", errors="replace")
