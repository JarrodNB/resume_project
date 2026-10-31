# AGENTS.md — services/ai/mcp_tools

## Purpose

The standalone MCP tool server (the `ai-mcp` Compose service) and the client agents use to
call it. See docs/architecture/chat.md#tools-mcp for the design.

## Contents

- `server.py` — builds the FastMCP server with token auth and `/health`; `create_app` is the
  uvicorn factory for `ai-mcp`.
- `tokens.py` — signs and verifies the short-lived per-operation tokens (`MCP_TOOLS_SECRET`).
- `career_library.py` — the whole `read_career_library` tool: its server half (structured data
  plus saved check status) and its client half (screening, rendering and the size cap).
- `client.py` — generic per-run toolset over HTTP: mints the token, routes each call to its
  tool's client half through `TOOL_RENDERERS`, caches each tool-and-arguments pair once per run, and runs without tools
  when the server is unreachable. No tool-specific code lives here.
- `local_server.py` — serves the real HTTP app on localhost for tests and offline evals.

## Local Rules

- The server takes the user only from the verified token. Tools never accept user or
  internal record IDs as arguments.
- Server tools are read-only and make no model calls. SQL stays in `database/`, filtered by
  the token's user. Raise `ToolError` with a short code; never send exception details back.
- The model only sees text the client has screened and rendered: reuse saved field
  approvals, screen the rest with the caller's accounted screen, render readable labeled
  text with `model_inputs/` (never JSON), enforce item/text caps and fail the operation on overflow or rejected/unavailable checks.
  Pending library fields are screened together; never screen each skill independently.
  New exact fingerprinted approvals return through chat acceptance for Rails to persist.
- One file per tool (or per tight group of tools) holds both halves and the tool's name,
  description and version constants, so the two sides cannot drift apart.
- To add a tool: write `mcp_tools/<tool>.py` with a `register_<tool>_tools(server, ...)`
  function and an async `render_<tool>_result(call_tool, tool_args, screen)` function, call
  the register function from `create_mcp_server` in `server.py`, and add the renderer to
  `TOOL_RENDERERS` in `client.py`. A server tool without a renderer stays hidden from
  agents; `test_every_server_tool_has_a_client_renderer` catches that.
- Never enable MCP sampling. Paid work belongs to the caller, so usage is recorded on its
  operation; missing usage stays unknown.
- Server spans carry metadata only, never library text. Give each tool a version constant,
  record it on its span, and bump it when the tool's description, arguments or output change.
- Tests run the real HTTP app through `local_server.py`; never call a running `ai-mcp`.

- `saved_jobs.py` — active saved-job list server/client halves and compact signed owner/operation-bound references; references expire with the issuing token and require no replica-local state.
- `saved_jobs.py` also implements `read_job_summary`, validating selection references before independently owned active reads and caller screening.
