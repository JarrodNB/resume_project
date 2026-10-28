"""Keep job fetches on the fixed public endpoint even with a redirecting client."""

import httpx
import pytest

from scrapers.linkedin.fetch_linkedin_job import fetch_linkedin_job_html


@pytest.mark.parametrize("target", ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "https://other.example/jobs"])
def test_rejects_redirect_without_requesting_target(target):
    requests = []

    def respond(request):
        requests.append(str(request.url))
        return httpx.Response(302, headers={"Location": target})

    with httpx.Client(transport=httpx.MockTransport(respond), follow_redirects=True) as client:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_linkedin_job_html("123", client)
    assert requests == ["https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/123"]
