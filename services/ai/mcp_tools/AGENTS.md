# AGENTS.md — services/ai/mcp_tools

## Purpose

The standalone MCP tool server (the `ai-mcp` Compose service) and the client agents use to
call it. See docs/architecture/chat.md#tools-mcp for the design.

## Contents

- `server.py` — builds the FastMCP server with token auth and `/health`; `create_app` is the
  uvicorn factory for `ai-mcp`.
- `tokens.py` — signs and verifies the short-lived per-operation tokens (`MCP_TOOLS_SECRET`).
- `career_library.py` — server side of `read_career_library`: structured data plus saved check status.
- `client.py` — per-run toolset over HTTP: mints the token, screens and renders results,
  allow-lists tools, and runs without tools when the server is unreachable.
- `local_server.py` — serves the real HTTP app on localhost for tests and offline evals.

## Local Rules

- The server takes the user only from the verified token. Tools never accept user or
  internal record IDs as arguments.
- Server tools are read-only and make no model calls. SQL stays in `database/`, filtered by
  the token's user. Raise `ToolError` with a short code; never send exception details back.
- The model only sees text the client has screened and rendered: reuse saved field
  approvals, screen the rest with the caller's accounted screen, render readable labeled
  text with `model_inputs/` (never JSON), cap the size and say what was left out.
- A new server tool is hidden from agents until `client.py` adds a renderer for it.
- Never enable MCP sampling. Paid work belongs to the caller, so usage is recorded on its
  operation; missing usage stays unknown.
- Server spans carry metadata only, never library text. Give each tool a version constant,
  record it on its span, and bump it when the tool's description, arguments or output change.
- Tests run the real HTTP app through `local_server.py`; never call a running `ai-mcp`.
