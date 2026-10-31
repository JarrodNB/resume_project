"""Exercise saved-job tools through the authenticated MCP HTTP boundary."""
import pytest
from fastmcp import Client
from fastmcp.client.auth import BearerAuth

from mcp_tools.local_server import serve_in_background
from mcp_tools.server import create_mcp_server
from mcp_tools.tokens import mint_tool_token
from schemas.gap_analysis_context import CareerLibrary

SECRET = "saved-job-test-secret-0123456789abcdef"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_saved_job_list_is_available_over_authenticated_http():
    app = create_mcp_server(secret=SECRET, read_library=lambda _: CareerLibrary()).http_app(
        path="/mcp", stateless_http=True)
    with serve_in_background(app) as url:
        token = mint_tool_token(SECRET, user_id="owner", operation_id="operation")
        async with Client(url, auth=BearerAuth(token)) as client:
            names = {tool.name for tool in await client.list_tools()}
            assert "list_saved_jobs" in names


@pytest.mark.anyio
async def test_list_reads_token_owner_and_renders_only_checked_labels():
    from uuid import uuid4

    from mcp_tools.client import _ResultHandler
    from mcp_tools.saved_jobs import resolve_job_reference
    users = []
    job_id = str(uuid4())
    def read(user):
        users.append(user)
        return [{"id": job_id, "title": "Engineer", "company": "Acme",
                 "screened_fields": ["title", "company"], "notes": "PRIVATE"}]
    async def screen(text):
        pytest.fail("Saved checks must be reused")
    app = create_mcp_server(secret=SECRET, read_library=lambda _: CareerLibrary(), read_jobs=read).http_app(
        path="/mcp", stateless_http=True)
    with serve_in_background(app) as url:
        token = mint_tool_token(SECRET, user_id="owner", operation_id="operation")
        async with Client(url, auth=BearerAuth(token)) as client:
            async def call(name, args):
                return (await client.call_tool(name, args)).structured_content
            text = await _ResultHandler(screen)(None, call, "list_saved_jobs", {})
    assert users == ["owner"]
    assert "Title: Engineer" in text and "Company: Acme" in text
    assert job_id not in text and "PRIVATE" not in text and "{" not in text
    reference = text.split("Reference: ")[1].splitlines()[0]
    assert len(reference) == 45
    assert resolve_job_reference(SECRET, reference, user_id="owner", operation_id="operation") == job_id


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["missing", "bad", "expired", "audience"])
async def test_auth_rejects_before_any_saved_jobs_read(kind):
    import time

    import jwt

    from mcp_tools.tokens import TOKEN_AUDIENCE, TOKEN_ISSUER
    users = []
    claims = {"iss": TOKEN_ISSUER, "aud": TOKEN_AUDIENCE, "sub": "owner", "operation_id": "op",
              "exp": int(time.time()) + 60}
    if kind == "expired":
        claims["exp"] -= 120
    if kind == "audience":
        claims["aud"] = "wrong"
    token = "bad" if kind == "bad" else jwt.encode(claims, SECRET, algorithm="HS256")
    app = create_mcp_server(secret=SECRET, read_library=lambda _: CareerLibrary(),
                            read_jobs=lambda user: users.append(user) or []).http_app(path="/mcp", stateless_http=True)
    with serve_in_background(app) as url, pytest.raises(Exception):  # noqa: B017
        async with Client(url, auth=None if kind == "missing" else BearerAuth(token)) as client:
            await client.call_tool("list_saved_jobs", {})
    assert users == []


@pytest.mark.anyio
async def test_database_failure_hides_details():
    import psycopg
    def read(_):
        raise psycopg.OperationalError("private password details")
    app = create_mcp_server(secret=SECRET, read_library=lambda _: CareerLibrary(), read_jobs=read).http_app(
        path="/mcp", stateless_http=True)
    with serve_in_background(app) as url:
        async with Client(url, auth=BearerAuth(mint_tool_token(SECRET, user_id="owner", operation_id="op"))) as client:
            result = await client.call_tool("list_saved_jobs", {}, raise_on_error=False)
    assert result.is_error and "private password" not in str(result.content)


@pytest.mark.anyio
@pytest.mark.parametrize("decision,code", [("blocked", "screening_blocked"),
    ("unchecked", "screening_unavailable"), ("long", "context_limit"), ("allowed", None)])
async def test_unchecked_labels_are_screened_together_and_fail_closed(decision, code):
    from mcp_tools.saved_jobs import render_saved_jobs_result
    from screening.library_inputs import LibraryScreeningError
    from screening.screen_user_text import ScreenOutcome
    from screening.session import current_session, screening_session
    seen = []
    async def call(*_):
        return {"jobs": [{"id": "job-1", "title": "Engineer", "company": "Acme", "reference": "J-test",
                          "screened_fields": []}]}
    async def screen(text):
        seen.append(text)
        return ScreenOutcome(decision == "allowed", unchecked=decision == "unchecked", too_long=decision == "long")
    with screening_session():
        if code:
            with pytest.raises(LibraryScreeningError, match=code):
                await render_saved_jobs_result(call, {}, screen)
            assert not current_session().record_screening
        else:
            assert "Acme" in await render_saved_jobs_result(call, {}, screen)
            report = current_session().record_screening[0]
            assert report.record_type == "job" and set(report.fingerprints) == {"title", "company"}
    assert len(seen) == 1 and "Engineer" in seen[0] and "Acme" in seen[0]


@pytest.mark.anyio
@pytest.mark.parametrize("count,title", [(501, "Engineer"), (1, "x" * 40_001)])
async def test_limits_reject_complete_list_before_screening(count, title):
    from mcp_tools.saved_jobs import render_saved_jobs_result
    from screening.library_inputs import LibraryScreeningError
    async def call(*_):
        return {"jobs": [{"id": str(i), "title": title, "company": "Acme", "reference": "J-test",
                          "screened_fields": []} for i in range(count)]}
    async def screen(_):
        pytest.fail("Overflow must be rejected before screening")
    with pytest.raises(LibraryScreeningError, match="context_limit"):
        await render_saved_jobs_result(call, {}, screen)


@pytest.mark.anyio
async def test_empty_and_unavailable_results_are_explicit():
    from mcp_tools.saved_jobs import render_saved_jobs_result
    from screening.library_inputs import LibraryScreeningError
    async def empty(*_):
        return {"jobs": []}
    async def unavailable(*_):
        raise RuntimeError("private details")
    assert await render_saved_jobs_result(empty, {}, None) == "The user has no active saved jobs."
    with pytest.raises(LibraryScreeningError, match="execution_failed"):
        await render_saved_jobs_result(unavailable, {}, None)


@pytest.mark.anyio
async def test_server_rejects_overflow_and_arguments_cannot_select_another_owner():
    from uuid import uuid4
    users = []
    def read(user):
        users.append(user)
        return [{"id": str(uuid4()), "title": "Engineer"}] * 501
    app = create_mcp_server(secret=SECRET, read_library=lambda _: CareerLibrary(), read_jobs=read).http_app(
        path="/mcp", stateless_http=True)
    with serve_in_background(app) as url:
        async with Client(url, auth=BearerAuth(mint_tool_token(SECRET, user_id="owner", operation_id="op"))) as client:
            result = await client.call_tool("list_saved_jobs", {}, raise_on_error=False)
            assert result.is_error
            assert "saved_jobs_context_limit" in str(result.content)
            await client.call_tool("list_saved_jobs", {"user_id": "other"}, raise_on_error=False)
    assert users and set(users) == {"owner"}


@pytest.mark.anyio
async def test_identical_list_calls_reuse_read_and_screening():
    from mcp_tools.client import _ResultHandler
    from screening.screen_user_text import ScreenOutcome
    reads, checks = [], []
    async def call(*_):
        reads.append(True)
        return {"jobs": [{"id": "job", "title": "Engineer", "company": "Acme", "reference": "J-test",
                          "screened_fields": []}]}
    async def screen(text):
        checks.append(text)
        return ScreenOutcome(True)
    handler = _ResultHandler(screen)
    first = await handler(None, call, "list_saved_jobs", {})
    assert first == await handler(None, call, "list_saved_jobs", {})
    assert len(reads) == len(checks) == 1


def test_selection_references_bind_owner_operation_and_expiry_across_instances():
    import time
    from uuid import uuid4

    from mcp_tools.saved_jobs import issue_job_reference, resolve_job_reference
    job_id = str(uuid4())
    reference = issue_job_reference(SECRET, job_id=job_id, user_id="owner", operation_id="op",
                                    expires_at=int(time.time()) + 60)
    assert resolve_job_reference(SECRET, reference, user_id="owner", operation_id="op") == job_id
    for user, operation, candidate in [("other", "op", reference), ("owner", "other", reference),
        ("owner", "op", reference[:-1] + ("A" if reference[-1] != "A" else "B")),
        ("owner", "op", issue_job_reference(SECRET, job_id=job_id, user_id="owner", operation_id="op",
                                             expires_at=int(time.time()) - 1))]:
        with pytest.raises(ValueError, match="invalid job reference"):
            resolve_job_reference(SECRET, candidate, user_id=user, operation_id=operation)
