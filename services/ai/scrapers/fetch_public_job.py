"""Fetch one public job page without credentials, rebinding or unchecked redirects.

The injected client's normal transport/proxy routing stays active. Requests use
validated literal IPs with the original Host and TLS SNI, so neither a local nor
proxy-side second DNS lookup can switch the destination to a private address.
No cookies, authorization headers or client defaults are copied into requests.
"""

from contextlib import closing
from time import monotonic
from urllib.parse import urljoin

import httpx

from scrapers.job_page import JobPageUnreadableError, JobPostingNotFoundError
from scrapers.public_job_url import public_job_url, resolve_public_job_host

MAX_JOB_PAGE_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
FETCH_BUDGET_SECONDS = 20


def fetch_public_job_html(url: str, client: httpx.Client) -> str:
    """Validate and pin every hop; bound streamed bytes and elapsed fetch time."""
    deadline = monotonic() + FETCH_BUDGET_SECONDS
    current = public_job_url(url)
    for hop in range(MAX_REDIRECTS + 1):
        target = httpx.URL(current)
        address = resolve_public_job_host(target.host, target.port or (443 if target.scheme == "https" else 80), deadline)
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise JobPageUnreadableError("The job website took too long")
        # A new Request bypasses client cookies/default headers and send(auth=None)
        # bypasses client authentication. Environment proxy/CA settings stay intact.
        request = httpx.Request(
            "GET", target.copy_with(host=address),
            headers={"Host": target.netloc.decode("ascii"), "Accept-Encoding": "identity",
                     "Accept": "text/html,application/xhtml+xml", "User-Agent": "Careergrind job import"},
            extensions={"sni_hostname": target.host, "job_origin_hostname": target.host,
                        "timeout": httpx.Timeout(min(2, remaining), connect=min(5, remaining)).as_dict()},
        )
        with closing(client.send(request, stream=True, follow_redirects=False, auth=None)) as response:
            if response.status_code in (301, 302, 303, 307, 308):
                if hop == MAX_REDIRECTS or not response.headers.get("location"):
                    raise JobPageUnreadableError("The job website redirected too many times")
                next_url = public_job_url(urljoin(current, response.headers["location"]))
                if target.scheme == "https" and httpx.URL(next_url).scheme != "https":
                    raise JobPageUnreadableError("The job website redirected to an insecure page")
                current = next_url
                continue
            if response.status_code in (404, 410):
                raise JobPostingNotFoundError(url)
            if response.status_code in (401, 403):
                raise JobPageUnreadableError("The job website requires login or blocks access; paste the ad instead")
            response.raise_for_status()
            if response.headers.get("content-encoding", "identity").lower() != "identity":
                raise JobPageUnreadableError("Compressed job pages are not supported; paste the ad instead")
            media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if media_type not in ("text/html", "application/xhtml+xml"):
                raise JobPageUnreadableError("The job URL did not return a web page")
            length = response.headers.get("content-length")
            if length and (not length.isascii() or not length.isdigit() or int(length) > MAX_JOB_PAGE_BYTES):
                raise JobPageUnreadableError("The job page is too large to read")
            content = bytearray()
            # Do not coalesce chunks: slow responses must reach the deadline check
            # for each network chunk, rather than waiting for a large buffer to fill.
            for chunk in response.iter_raw():
                if monotonic() >= deadline:
                    raise JobPageUnreadableError("The job website took too long")
                if len(content) + len(chunk) > MAX_JOB_PAGE_BYTES:
                    raise JobPageUnreadableError("The job page is too large to read")
                content.extend(chunk)
            if monotonic() >= deadline:
                raise JobPageUnreadableError("The job website took too long")
            return content.decode(response.encoding or "utf-8", errors="replace")
    raise JobPageUnreadableError("The job website could not be read")
