"""The standalone MCP tool server (the `ai-mcp` service).

It runs as its own long-lived process over streamable HTTP at `/mcp`, separate from the
chat runtime. Every request needs a token signed with `MCP_TOOLS_SECRET` (see
tokens.py); the server takes the user from that token. Tools are read-only and make no
model calls, so the server records no AI usage. `/health` answers without auth.

Run it with: uvicorn --factory mcp_tools.server:create_app --host 0.0.0.0 --port 8000
"""
from collections.abc import Callable
from uuid import UUID

from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import PlainTextResponse

from mcp_tools.career_library import register_career_library_tools
from mcp_tools.saved_jobs import register_saved_jobs_tools
from mcp_tools.tokens import tool_token_secret, tool_token_verifier
from schemas.gap_analysis_context import CareerLibrary


def create_mcp_server(*, secret: str, read_library: Callable[[UUID | str], CareerLibrary], read_jobs=None) -> FastMCP:
    """Build the tool server with token auth and every tool registered."""
    server = FastMCP("careergrind-tools", auth=tool_token_verifier(secret), mask_error_details=True)

    @server.custom_route("/health", methods=["GET"])
    async def health(request: Request) -> PlainTextResponse:
        return PlainTextResponse("ok")

    register_career_library_tools(server, read_library)
    if read_jobs is None:
        from database.saved_jobs import build_database_saved_jobs_reader
        from settings import load_settings
        read_jobs = build_database_saved_jobs_reader(load_settings())
    register_saved_jobs_tools(server, read_jobs, secret=secret)
    return server


def create_app():
    """Production entry point: real database reader, Logfire tracing, HTTP app."""
    from database.career_library_reader import build_database_library_reader
    from settings import load_settings
    from telemetry.tracing import configure_tracing

    # Requests carry the caller's trace context in MCP _meta, so tool spans join chat's trace.
    configure_tracing(distributed_tracing=True)
    server = create_mcp_server(secret=tool_token_secret(),
                               read_library=build_database_library_reader(load_settings()))
    # Stateless: each request stands alone, so any replica can answer it.
    return server.http_app(path="/mcp", stateless_http=True)
