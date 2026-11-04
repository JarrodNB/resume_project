"""Connect an agent run to the MCP tool server over HTTP, acting for one user.

Each run gets a toolset carrying a fresh token for its user and operation. Tool results
come back as structured data, and each tool's own module turns them into screened,
readable text before the model sees them (see TOOL_RENDERERS). This file holds only what
every tool shares: the connection, the token, a per-run cache keyed by tool and arguments, a plain
sentence for the model when a tool's result can't be used, and running without tools when the
server is unreachable. Only tools listed in TOOL_RENDERERS are offered.
"""
import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime

import logfire
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.toolsets import AbstractToolset, WrapperToolset

from mcp_tools.career_library import READ_CAREER_LIBRARY, render_career_library_result
from mcp_tools.saved_jobs import (
    LIST_SAVED_JOBS,
    READ_JOB_SUMMARY,
    render_job_summary_result,
    render_saved_jobs_result,
)
from mcp_tools.tokens import mint_tool_token, tool_token_secret
from screening.library_inputs import LibraryScreeningError
from settings import AISettings

# Server tools the model may see, each with its client half: (call_tool, tool_args, screen) -> text.
# A server tool missing here stays hidden, because nothing would screen and render its result.
TOOL_RENDERERS = {
    LIST_SAVED_JOBS: render_saved_jobs_result,
    READ_JOB_SUMMARY: render_job_summary_result,
    READ_CAREER_LIBRARY: render_career_library_result,
}

# What the model reads when a tool's result can't be used. A saved record failing its check is
# not the user's message being blocked, so the reply continues and the model explains it.
TOOL_FAILURE_RESPONSES = {
    "screening_blocked": "This saved information was not shown because part of it did not pass the "
                         "safety check. Tell the user it can't be used right now and that they can "
                         "review the saved entry. Do not guess what it says.",
    "screening_unavailable": "This saved information was not shown because the safety check is "
                             "unavailable right now. Tell the user to try again shortly. Do not "
                             "guess what it says.",
    "context_limit": "This saved information is too large to show here. Tell the user, and do not "
                     "guess what it says.",
}
TOOL_UNAVAILABLE_RESPONSE = ("This saved information could not be read right now. Tell the user to "
                             "try again shortly. Do not guess what it says.")


@dataclass(frozen=True)
class ToolServerConnection:
    """Where the MCP tool server is, and the secret for signing its tokens."""

    url: str
    secret: str

    @classmethod
    def from_environment(cls, settings: AISettings) -> "ToolServerConnection":
        return cls(url=os.getenv("MCP_TOOLS_URL", "").strip() or settings.mcp_tools_url, secret=tool_token_secret())

    def toolset(self, *, user_id: str, operation_id: str, expires_at: datetime | None,
                screen: Callable[[str], Awaitable[object]]) -> AbstractToolset:
        """Build one run's toolset. screen returns a screening decision and records its own usage."""
        token = mint_tool_token(self.secret, user_id=user_id, operation_id=operation_id, expires_at=expires_at)
        handler = _ResultHandler(screen)
        # Sampling stays off: the server can never make model calls outside the caller's accounting.
        toolset = MCPToolset(self.url, id="careergrind_tools", headers={"Authorization": f"Bearer {token}"},
                             process_tool_call=handler, max_retries=0, sampling_model=None)
        return _OptionalToolset(toolset.filtered(lambda ctx, tool: tool.name in TOOL_RENDERERS))


@dataclass
class _ResultHandler:
    """Send each tool call through its renderer, once per tool and arguments per run."""

    screen: Callable[[str], Awaitable[object]]
    results: dict[tuple[str, str], str] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def __call__(self, ctx, call_tool, name, tool_args):
        # Models may request the same call in parallel. Keep its read and paid
        # screening together so another call reuses the completed result.
        # Different arguments are different reads, so they never share a result.
        key = (name, json.dumps(tool_args or {}, sort_keys=True, default=str))
        async with self._lock:
            if key not in self.results:
                try:
                    self.results[key] = await TOOL_RENDERERS[name](call_tool, tool_args, self.screen)
                except LibraryScreeningError as error:
                    logfire.warn("MCP tool result not shown", tool=name, reason=str(error))
                    self.results[key] = TOOL_FAILURE_RESPONSES.get(str(error), TOOL_UNAVAILABLE_RESPONSE)
            return self.results[key]


class _OptionalToolset(WrapperToolset):
    """Offer no tools, instead of failing the run, when the server cannot be reached."""

    _available = True

    async def __aenter__(self):
        try:
            await self.wrapped.__aenter__()
        except Exception as error:  # noqa: BLE001 - connection failures vary by transport
            self._available = False
            logfire.warn("MCP tool server unavailable", error_type=type(error).__name__)
        return self

    async def __aexit__(self, *args):
        if self._available:
            return await self.wrapped.__aexit__(*args)
        return None

    async def get_tools(self, ctx):
        if not self._available:
            return {}
        try:
            return await self.wrapped.get_tools(ctx)
        except Exception as error:  # noqa: BLE001 - e.g. a rejected token or a server restart
            self._available = False
            logfire.warn("MCP tool server unavailable", error_type=type(error).__name__)
            return {}

