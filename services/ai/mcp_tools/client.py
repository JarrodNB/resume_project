"""Connect an agent run to the MCP tool server over HTTP, acting for one user.

Each run gets a toolset carrying a fresh token for its user and operation. Tool results
come back as structured data, and each tool's own module turns them into screened,
readable text before the model sees them (see TOOL_RENDERERS). This file holds only what
every tool shares: the connection, the token, a per-run cache keyed by tool and arguments, and running without
tools when the server is unreachable. Only tools listed in TOOL_RENDERERS are offered.
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
from mcp_tools.tokens import mint_tool_token, tool_token_secret
from settings import AISettings

# Server tools the model may see, each with its client half: (call_tool, tool_args, screen) -> text.
# A server tool missing here stays hidden, because nothing would screen and render its result.
TOOL_RENDERERS = {
    READ_CAREER_LIBRARY: render_career_library_result,
}


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
                self.results[key] = await TOOL_RENDERERS[name](call_tool, tool_args, self.screen)
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

