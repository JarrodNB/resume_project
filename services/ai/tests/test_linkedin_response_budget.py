"""Stop oversized streamed job pages without buffering the rest of the response."""

import httpx
import pytest

from scrapers.job_page import JobPageUnreadableError
from scrapers.linkedin.fetch_linkedin_job import MAX_JOB_PAGE_BYTES, fetch_linkedin_job_html


class EndlessPage(httpx.SyncByteStream):
    def __init__(self):
        self.chunks = 0
        self.closed = False

    def __iter__(self):
        for _ in range(1000):
            self.chunks += 1
            yield b"x" * 65536

    def close(self):
        self.closed = True


def test_stops_reading_and_closes_oversized_response():
    page = EndlessPage()
    with (
httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=page))) as client,
pytest.raises(JobPageUnreadableError),
    ):
        fetch_linkedin_job_html("123", client)
    assert page.chunks == MAX_JOB_PAGE_BYTES // 65536 + 1
    assert page.closed


def test_accepts_page_at_byte_limit():
    content = b"x" * MAX_JOB_PAGE_BYTES
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=content))) as client:
        assert fetch_linkedin_job_html("123", client) == content.decode()


def test_rejects_compressed_response_before_decompression():
    page = EndlessPage()
    def respond(request):
        assert request.headers["accept-encoding"] == "identity"
        return httpx.Response(200, headers={"content-encoding": "gzip"}, stream=page)
    with (
httpx.Client(transport=httpx.MockTransport(respond)) as client,
pytest.raises(JobPageUnreadableError),
    ):
        fetch_linkedin_job_html("123", client)
    assert page.chunks == 0
    assert page.closed
