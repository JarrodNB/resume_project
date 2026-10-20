"""Read a job ID from a copied LinkedIn link and build its canonical URL.

Malformed URLs are rejected just like unsupported links, so pasted input does
not interrupt scraper selection or job ID parsing.
"""

import re
from urllib.parse import parse_qs, urlparse

LINKEDIN_HOST = "linkedin.com"
JOB_VIEW_PATH = re.compile(r"^/(?:comm/)?jobs/view/(?:[^/]*-)?(?P<job_id>\d+)/?$")
JOBS_PATH_PREFIX = "/jobs/"
SELECTED_JOB_PARAM = "currentJobId"


def is_linkedin_url(url: str) -> bool:
    """True for linkedin.com and its subdomains (www., uk., ...)."""
    host = _host(url)
    return host == LINKEDIN_HOST or host.endswith(f".{LINKEDIN_HOST}")


def parse_linkedin_job_id(url: str) -> str | None:
    """Supports /jobs/view/{id}, /jobs/view/{title-slug}-{id}, email links (/comm/jobs/view/),
    and search or collection pages with a job open (?currentJobId={id})."""
    try:
        parsed_url = urlparse(url.strip())
    except ValueError:
        return None
    if parsed_url.scheme not in ("http", "https") or not is_linkedin_url(url):
        return None

    if match := JOB_VIEW_PATH.match(parsed_url.path):
        return match["job_id"]

    if parsed_url.path.startswith(JOBS_PATH_PREFIX):
        selected_job_id = parse_qs(parsed_url.query).get(SELECTED_JOB_PARAM, [""])[0]
        if selected_job_id.isdigit():
            return selected_job_id
    return None


def linkedin_job_url(job_id: str) -> str:
    """The job's link without tracking parameters."""
    return f"https://www.linkedin.com/jobs/view/{job_id}/"


def _host(url: str) -> str:
    """The URL's lower-cased host name, without a port."""
    try:
        return (urlparse(url.strip()).hostname or "").lower()
    except ValueError:
        return ""
