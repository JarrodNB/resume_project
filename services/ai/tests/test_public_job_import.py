"""Import arbitrary public job pages and reject unsafe destinations before any request."""

import json
import socket
from dataclasses import replace

import httpx
import pytest
from pydantic_ai.models.test import TestModel

from agents.parse_scraped_job_posting_agent import parse_scraped_job_posting_agent
from scrapers.fetch_public_job import MAX_JOB_PAGE_BYTES, fetch_public_job_html
from scrapers.job_page import JobPageUnreadableError, UnsupportedJobUrlError
from scrapers.public_job_page import public_job_html_to_page
from scrapers.public_job_transport import PinnedJobTLSContext
from scrapers.public_job_url import public_ip, public_job_url, resolve_public_job_host
from tests.test_scrape_job_handler import build_scrape_job_task
from worker.scrape_job_handler import UNREADABLE_PAGE_MESSAGE
from worker.task_handlers import handle_ai_task

URL = "https://company.com/careers/engineer?jobId=42"
IP = "93.184.216.34"
AD = """<html><body><nav>Unrelated jobs</nav><main><h1>Backend Engineer</h1>
<p>Northwind is hiring in Seattle.</p><p>You must have Python experience.</p>
<p>You will build APIs.</p><p>Go experience is preferred.</p></main>
<footer>Other company: Tailspin</footer></body></html>"""


@pytest.fixture
def public_dns(monkeypatch):
    answers = []

    def resolve(host, port, **kwargs):
        answers.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (IP, port))]

    monkeypatch.setattr("scrapers.public_job_url.socket.getaddrinfo", resolve)
    return answers


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://company.com/job", "https://localhost/job",
    "https://user:password@company.com/job", "https://company.com:8443/job",
    "http://127.0.0.1/job", "http://169.254.169.254/latest/meta-data/",
    "https://[::1]/job", "https://company.internal/job", "https://company.com\\@localhost/job",
    "https://company.com/\njob", "https://company.com/" + "x" * 2048,
])
def test_unsafe_url_forms_are_rejected(url):
    with pytest.raises(UnsupportedJobUrlError):
        public_job_url(url)


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.0.0.1", "169.254.169.254", "100.100.100.200",
    "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1",
    "::ffff:127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1",
])
def test_special_addresses_are_never_public(address):
    assert not public_ip(address)


def test_mixed_public_private_dns_answers_are_rejected(monkeypatch):
    monkeypatch.setattr("scrapers.public_job_url.socket.getaddrinfo", lambda *a, **kw: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", (IP, 443)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443)),
    ])
    with pytest.raises(UnsupportedJobUrlError):
        resolve_public_job_host("company.com", 443, __import__("time").monotonic() + 5)


def test_fetch_pins_ip_and_does_not_forward_client_secrets(public_dns):
    seen = []

    def respond(request):
        seen.append(request)
        assert request.url.host == IP
        assert request.headers["host"] == "company.com"
        assert request.extensions["sni_hostname"] == "company.com"
        assert request.extensions["job_origin_hostname"] == "company.com"
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        assert "x-private-key" not in request.headers
        return httpx.Response(200, stream=httpx.ByteStream(AD.encode()), headers={"content-type": "text/html"})

    with httpx.Client(transport=httpx.MockTransport(respond), auth=("secret", "password"),
                      headers={"X-Private-Key": "secret"}, cookies={"session": "secret"}) as client:
        assert "Backend Engineer" in fetch_public_job_html(URL, client)
    assert public_dns == ["company.com"]
    assert len(seen) == 1


def test_redirect_to_private_address_is_rejected_without_contact(public_dns):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})

    with (httpx.Client(transport=httpx.MockTransport(respond), follow_redirects=True) as client,
          pytest.raises(UnsupportedJobUrlError)):
        fetch_public_job_html(URL, client)
    assert len(requests) == 1


def test_each_redirect_resolves_and_pins_its_own_public_destination(public_dns):
    requests = []

    def respond(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(302, headers={"location": "https://careers.company.com/job/42"})
        return httpx.Response(200, stream=httpx.ByteStream(AD.encode()), headers={"content-type": "text/html"})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        fetch_public_job_html(URL, client)
    assert public_dns == ["company.com", "careers.company.com"]
    assert [request.url.host for request in requests] == [IP, IP]
    assert requests[1].headers["host"] == "careers.company.com"


@pytest.mark.parametrize("headers,body", [
    ({"content-type": "application/pdf"}, b"PDF"),
    ({"content-type": "text/html", "content-encoding": "gzip"}, b"bad gzip"),
    ({"content-type": "text/html", "content-length": str(MAX_JOB_PAGE_BYTES + 1)}, b""),
    ({"content-type": "text/html"}, b"x" * (MAX_JOB_PAGE_BYTES + 1)),
])
def test_invalid_or_oversized_responses_fail_before_parsing(public_dns, headers, body):
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, headers=headers,
                         stream=httpx.ByteStream(body)))) as client, pytest.raises(JobPageUnreadableError):
        fetch_public_job_html(URL, client)


def test_slow_stream_checks_elapsed_budget_without_buffering_large_chunks(public_dns, monkeypatch):
    clock = [0]
    monkeypatch.setattr("scrapers.fetch_public_job.monotonic", lambda: clock[0])
    monkeypatch.setattr("scrapers.fetch_public_job.resolve_public_job_host", lambda *a: IP)

    class SlowPage(httpx.SyncByteStream):
        closed = False

        def __iter__(self):
            yield b"a"
            clock[0] = 21
            yield b"b"
            raise AssertionError("The budget did not stop the response")

        def close(self):
            self.closed = True

    page = SlowPage()
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200,
                         headers={"content-type": "text/html"}, stream=page))) as client, pytest.raises(JobPageUnreadableError):
        fetch_public_job_html(URL, client)
    assert page.closed


def test_jsonld_is_local_metadata_not_remote_fetch_instructions():
    job = {"@type": "JobPosting", "@context": "http://169.254.169.254/",
           "title": "Engineer", "hiringOrganization": {"name": "Northwind"},
           "description": "<p>Python experience is required.</p>", "url": "http://127.0.0.1/admin"}
    page = public_job_html_to_page('<script type="application/ld+json">' + json.dumps(job) + '</script>', URL)
    assert page.title == "Engineer"
    assert page.company == "Northwind"
    assert page.source_url == URL


def test_multiple_jobs_and_login_pages_do_not_become_jobs():
    jobs = [{"@type": "JobPosting", "title": title, "description": "SQL required"}
            for title in ("Engineer", "Designer")]
    with pytest.raises(JobPageUnreadableError):
        public_job_html_to_page('<script type="application/ld+json">' + json.dumps(jobs) + '</script>', URL)
    with pytest.raises(JobPageUnreadableError):
        public_job_html_to_page('<main>Sign in<input type="password"></main>', URL)


@pytest.mark.parametrize("is_job", [True, False])
def test_general_url_to_structured_job_through_real_handler(public_dns, task_dependencies, is_job):
    seen = []

    def respond(request):
        seen.append(request)
        return httpx.Response(200, stream=httpx.ByteStream(AD.encode()), headers={"content-type": "text/html"})

    output = {"is_job_posting": is_job, "title": "Backend Engineer" if is_job else "",
              "company": "Northwind", "location": "Seattle",
              "requirements": ["Python experience"], "responsibilities": ["You will build APIs."],
              "nice_to_haves": ["Go experience is preferred."]}
    with (httpx.Client(transport=httpx.MockTransport(respond)) as client,
          parse_scraped_job_posting_agent.override(model=TestModel(custom_output_args=output))):
        result = handle_ai_task(build_scrape_job_task(URL), replace(task_dependencies, http_client=client))
    assert len(seen) == 1
    if not is_job:
        assert result.status == "failed"
        assert result.error_message == UNREADABLE_PAGE_MESSAGE
    else:
        assert result.status == "completed"
        job = result.result["scraped_job"]
        assert (job["title"], job["company"], job["location"]) == ("Backend Engineer", "Northwind", "Seattle")
        assert job["requirements"] == ["Python experience"]
        assert job["source_url"] == URL
        assert "Tailspin" not in job["description"]


def test_pinned_tls_keeps_hostname_verification_enabled(monkeypatch):
    import ssl

    context = PinnedJobTLSContext(IP, "company.com")
    assert context.check_hostname
    assert context.verify_mode == ssl.CERT_REQUIRED
    monkeypatch.setattr(ssl.SSLContext, "wrap_socket", lambda self, *a, server_hostname=None, **kw: server_hostname)
    assert context.wrap_socket(object(), server_hostname=IP) == "company.com"


def test_dns_timeout_does_not_hold_the_task_or_queue_unbounded_work(monkeypatch):
    from threading import Event
    from time import monotonic

    unblock = Event()

    def stalled_dns(*args, **kwargs):
        unblock.wait(1)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (IP, 443))]

    monkeypatch.setattr("scrapers.public_job_url.socket.getaddrinfo", stalled_dns)
    try:
        with pytest.raises(JobPageUnreadableError, match="timed out"):
            resolve_public_job_host("company.com", 443, monotonic() + 0.01)
    finally:
        unblock.set()


def test_redirect_loop_is_bounded(public_dns):
    requests = []

    def loop(request):
        requests.append(request)
        return httpx.Response(302, headers={"location": "/another"})

    with (httpx.Client(transport=httpx.MockTransport(loop)) as client,
          pytest.raises(JobPageUnreadableError)):
        fetch_public_job_html(URL, client)
    assert len(requests) == 4
