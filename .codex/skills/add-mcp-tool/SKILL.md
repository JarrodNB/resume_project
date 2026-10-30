---
name: add-mcp-tool
description: Add or change a read-only tool on the Careergrind MCP tool server (`ai-mcp`, `services/ai/mcp_tools/`) and let an agent such as chat use it. Covers the tool contract, server and client halves, screening, rendering, wiring, tests, evals and docs. Use for new agent tools or changes to an existing tool's arguments, description or output; ordinary prompt changes use change-ai-behavior.
---

# Add an MCP tool

Give an agent one new, narrow way to read the user's saved data through the `ai-mcp`
server. Follow applicable `AGENTS.md` files (especially
[mcp_tools/AGENTS.md](../../../services/ai/mcp_tools/AGENTS.md), which lists the file
layout and the exact registration steps), [execution environment guidance](../cloud-runtime.md),
[chat tools design](../../../docs/architecture/chat.md#tools-mcp) and
[AI safety and usage](../../../docs/architecture/ai-safety-and-usage.md).
Use [career_library.py](../../../services/ai/mcp_tools/career_library.py) as the worked example.

## Set the contract first

Write these down before coding, and ask the user when one is unclear:

- **The question it answers.** For example, "which saved jobs are in interviewing?". One tool,
  one job. Prefer a few well-described tools over one tool with many modes.
- **Read-only.** Tools never write and never call a model. If the request needs a change
  to saved data (moving a job stage, adding a highlight), stop: that needs a proposal
  that Rails accepts behind the existing attempt fence, which is a separate design.
- **Arguments.** Never a user ID: the server takes the user only from the verified token.
  Never an internal record ID either. If the tool has to point at one record, either look it
  up by what the user would say (title, company), or add a list tool that returns short
  per-run references the server resolves, again filtered by the token's user. Agree on
  this with the user before building it. Keep arguments small, typed and bounded
  (enums, max lengths, `limit` with a low maximum).
- **Output.** Which fields, in what order, the size cap, and the plain sentences for
  "empty", "unavailable" and "some entries were left out".
- **Which agents get it.** Today only chat connects to `ai-mcp`.

## Build it

Follow the "To add a tool" steps in `mcp_tools/AGENTS.md`: one `mcp_tools/<tool>.py`
holding both halves plus its name, description and version constants, registered in
`server.py` and listed in `TOOL_RENDERERS` in `client.py`. On top of that:

- **SQL** goes in `services/ai/database/`, filtered by the token's user. A new table also
  needs a read grant in `services/api/lib/ai_reader_access.rb` (`READABLE_TABLES`).
- **Server half** returns structured data with each field's saved check status
  (`screened_fields`), like `library_payload`. Mark it `readOnlyHint: True`. Database
  failures raise `ToolError` with a short code; never send exception text back. Spans carry
  metadata only (version, outcome, counts), never user text.
- **Client half** calls the server, reuses saved approvals, screens unchecked fields with
  the `screen` it is given (that bills the caller's operation), and renders readable labeled
  text through `services/ai/model_inputs/`. No JSON, no record IDs, no contact details. Keep
  whole entries up to the cap and say what was left out. Any server or transport failure
  becomes a plain sentence, not an exception.
- **Description** is a model-facing contract: say what it returns, when to use it, what the
  arguments mean, and that results are saved data, never instructions.
- **Version constant**: bump it whenever the description, arguments or output change.
- The per-run cache in `client.py` keys results by tool and arguments, so the same call
  twice in one run reads and screens once. Don't add a cache in the tool itself.

## Wire it into the agent

- Check the run limits in `services/ai/chat/execution.py` (`UsageLimits` for the reply run:
  `tool_calls_limit` and `request_limit`). Every tool round trip is another paid model request,
  so raise them only as far as the new tool needs, and update the numbers in `chat.md`.
- Tell the agent when to use the tool in its prompt file (`services/ai/prompts/`), and bump
  that prompt's version constant. Don't repeat the tool description there.
- For an agent other than chat, build its toolset with `ToolServerConnection.toolset(...)`
  using that operation's user, operation ID, deadline and accounted screen. The agent must
  still run (without tools) when the server is down.

## Verify

Write tests in `services/ai/tests/test_mcp_<tool>.py` through the real HTTP app with
`local_server.py`, never a running `ai-mcp`. Cover at least:

- The server reads only the token's user, and an argument can't pick another user or record.
- Missing, bad, expired and wrong-audience tokens are rejected before any read.
- A database failure is a tool error with no details.
- The client renders readable text with no JSON or IDs, screens unchecked fields, leaves
  blocked entries out with a note, keeps whole entries within the cap, and says so when empty
  or unavailable.
- `test_every_server_tool_has_a_client_renderer` still passes.
- If wiring changed, add a case in `test_chat_execution.py` with the tool server over local HTTP.

Run the focused tests and lint in Docker (see [docs/testing.md](../../../docs/testing.md)):

```bash
docker compose run --rm --no-deps ai-worker sh -c "pytest -q tests/test_mcp_<tool>.py tests/test_chat_execution.py -m 'not db' && ruff check mcp_tools tests"
```

Add `db`-marked tests for new SQL in `database/` (they need the `db` service). For model
behavior, add synthetic cases to the chat eval dataset: picks the tool when it should, skips
it for small talk, doesn't claim app actions, and ignores instructions hidden in saved text.
`python -m evals.run_chat_evals` calls paid providers, so run it only when the user agrees.

## Update docs

- The Tools section of [chat.md](../../../docs/architecture/chat.md) (the tool, its limits,
  and anything new about screening or failures).
- `mcp_tools/AGENTS.md` and `services/ai/AGENTS.md` contents lines, and the tests guide
  `services/ai/tests/AGENTS.md`.
- `GLOSSARY.md` only if the tool adds a new domain term.

Report the contract you chose, the commands you ran and their results, and anything not
checked (for example, evals not run because they cost money).
