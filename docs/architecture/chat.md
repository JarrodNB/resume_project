# Career chat

Chat is a career-focused text conversation. Users can create and reopen multiple
private conversations from the Chat page. It uses the dialogue the user provides and
one read-only tool, `read_career_library`. Attachments, other saved app data and app
actions are not available.

## Tools (MCP)

Chat tools come from a standalone MCP server, the `ai-mcp` service
(`services/ai/mcp_tools/`). It is one long-running FastMCP process serving streamable
HTTP at `/mcp`, separate from the chat runtime (`ai-http`). Chat connects to it by URL
(`MCP_TOOLS_URL`, default `http://ai-mcp:8000/mcp`) through Pydantic AI's `MCPToolset`.
Other internal services can connect the same way later.

```
ai-http (chat run) ──HTTP + Bearer token──▶ ai-mcp ──ai_reader──▶ Postgres
   screens + renders the result                 returns structured data only
```

- **Auth and scoping.** For each chat operation, `ai-http` signs a short-lived HS256
  token (`MCP_TOOLS_SECRET`) naming the claim's user and operation. It expires at the
  execution deadline, and after 10 minutes at most. The server checks signature, issuer,
  audience and expiry on every request and takes the user only from the token. Tools take
  no user or record IDs, so the model cannot choose whose data is read. The port is not
  published; only services on the internal network reach it. Anyone with the secret can
  act for any user, so only internal services get it.
- **Read-only, no model calls.** The server reads through the `ai_reader` role and
  user-filtered SQL in `services/ai/database/`. It never writes and never calls a model,
  so it records no AI usage. A future tool that changes data must return a proposal that
  Rails accepts, using the existing attempt fence.
- **Caller-side screening and rendering.** The server returns structured data, including
  each field's saved check status. The tool's client half (in the same file as its server
  half, `mcp_tools/career_library.py`) reuses saved
  approvals, screens unchecked fields with the claim's accounted screen, leaves out
  blocked entries with a note, and renders readable labeled text with no JSON or record IDs.
  So the model only sees screened text, and screening is billed to the chat operation.
  Results are capped at 40,000 characters and keep whole entries. New approvals are not
  saved back yet, so unchecked fields are screened again on later turns.
- **Allow-listed tools.** The model only sees server tools listed in `TOOL_RENDERERS`
  (`mcp_tools/client.py`), which maps each tool to its client half. A new server tool stays
  hidden from chat until it is listed there.
- **Failures.** If the server is unreachable or rejects the token, the run continues
  without tools. A database failure returns a generic tool error, and the model is told
  the library is unavailable. An empty library returns a plain sentence.
- **No sampling.** The toolset never lets the server call a model.

A reply run allows two tool calls and 12 model requests (each tool round trip is
another request). Text written before a tool call is kept: the saved reply joins the
text of every model response in the run, so it always matches what was streamed.
Repeated calls with the same arguments in one run reuse the first result.

## Ownership and execution

Rails owns conversations, accepted messages, pending operations, summary checkpoints
and feedback. Authenticated GraphQL reads and mutations scope every conversation to
its owner. Conversation and message history use bounded, signed cursor pages.
Failed and provisional output stays separate from accepted dialogue.

Interactive chat uses the same FastAPI app and `ExecutionRunner` as interviews.
A chat feature adapter opts into the existing optional streaming output. Claims,
heartbeats, leases, durable fallback delivery, recovery and attempt fencing use the
shared execution system; chat does not have a second dispatcher or supervisor.
Feature-owned Rails services authorize and accept chat results. Chat uses the general
AI allowance and never consumes the separate spoken-interview allowance.
`CHAT_MODEL` defaults to `openai:gpt-6-luna`; chat supports that model and
`openai:gpt-5-nano`, with the configured `GENERATIVE_FALLBACK_MODEL`. Jev remains
the fixed primary screening model.

Only one turn may run in a conversation at a time. Stable submission identities and
current-attempt fences prevent double sends and stale acceptance. A completed turn
saves the user message, assistant reply, and any summary change atomically. Failed
turns can be retried without adding them to accepted model history.

## Streaming

Replies are provisional until Rails accepts the final result. Browser observers use
the existing session-bound, short-lived stream capability. Redis holds only an
optional ephemeral replay buffer, not canonical history. Reconnect and missing-buffer
resets fetch authoritative Rails state; losing a stream does not restart paid work.
Buffer outages degrade to saved-result delivery.

Both Rails and FastAPI must enable `AI_STREAMING_ENABLED=true`. Configure the existing
`AI_STREAM_REDIS_URL` and exact `AI_BROWSER_ORIGINS` for the deployed browser origin.
See [streaming](ai-streaming.md) for replay, authorization, lease and runtime rules.

## Context and limits

`CHAT_MAX_INPUT_CHARACTERS` defaults to 10,000 characters per user message.
`CHAT_SUMMARIZE_EVERY_USER_MESSAGES` defaults to 20 accepted user messages. Rails
exposes the effective settings to the web client; server-side checks are authoritative.
Rejected or failed attempts do not advance the accepted-message count.

Rolling summaries replace old model context, not saved visible history. Each update
combines the previous summary with exactly the newly covered complete exchanges and
stores a versioned covered-message checkpoint. Keep the newest five complete exchanges
verbatim, plus all newer uncovered messages and the pending input. At turn 20 the
normal checkpoint covers exchanges 1–15; at turn 40 it incorporates exchanges 16–35.
Intermediate turns retain every exchange after the covered checkpoint.

Compaction can run earlier if the assembled prompt would exceed the existing hard
context limit. It must not silently discard dialogue or advance the normal cadence.
If even the minimum recent window does not fit, or required summarization fails,
return a recoverable error and preserve accepted state. Summary and reply text have
bounded output sizes, in addition to model request/token and execution deadline caps.

## Screening, privacy and accounting

Jev screens new untrusted input before generation or public output. A screening block
does not trigger fallback; attempted provider failures follow the established bounded
fallback policy, and unavailable required screening prevents generation. Accepted
history is trusted only through Rails-owned screening provenance. Unchanged approved
history and generated summaries are not screened again. Summaries remain conversation
data, never system instructions.

Contact masking remains active through model requests, provisional output, tracing and
exception handling. Render readable labeled dialogue rather than dumping objects into
prompts. Screening, generation, validation retries, summarization and failures retain
prompt versions, Logfire traces and actual usage. Tool runs add a
`mcp_client.read_career_library` span (section counts, outcome) under Pydantic AI's
tool-call span. FastMCP carries the trace context in each request's MCP `_meta`, so the
server's request span and its `mcp_tools.read_career_library` span (tool version, outcome)
join the same trace. Server spans record metadata only, never library text. Screening
in the client is billed like any other chat screen. Execution and per-provider
identities retain durable usage markers, so late receipts can record costs without authorizing stale result acceptance. Missing usage stays
unknown rather than becoming zero. See [AI safety and usage](ai-safety-and-usage.md).

## Feedback

An owner can set or clear thumbs up or thumbs down on an accepted assistant reply. These
choices are mutually exclusive. The desired-state
mutation is idempotent and persists across refresh. User messages and provisional
output cannot receive feedback. Feedback does not change accepted history, model context,
summary cadence, or usage, and does not trigger another provider request.

## Verification

Use authenticated GraphQL/domain tests for isolation, acceptance and replay; offline
fake-model execution tests for screening, bounded context, summary checkpoints and
failure accounting; and React component tests for send, recovery and feedback behavior.
Retain interview execution/streaming regressions when changing shared dispatch.
Model-quality evaluation uses synthetic cases and is separate from deterministic
correctness tests. Human QA covers visual layout and live device/browser behavior.

### Complete bounded library reads

`read_career_library-v3` returns the complete library or fails the operation. Each
collection and nested highlight list is capped at 500 items; preparation also caps
the total entries plus highlights at 500 and serialized source text at 80,000
characters. Database reads fetch at most 501 rows per collection to detect overflow
without loading an unlimited list. Chat checks the full rendered result against
40,000 characters before classification. No oversized list or result is truncated.

Pending fields are checked together as labeled plain text through the existing
bounded screening/chunking policy. Approved fields need no classifier call. A blocked,
unavailable or oversized library fails the operation; there is no per-entry retry or
partial answer. Classification fallback for a provider outage retains the shared
screening deadline and accounting policy.

Successful checks carry record IDs, field names and SHA-256 fingerprints of exact
canonical JSON string values. Chat returns these in `library_screening` on final
acceptance. Rails accepts them only under the current operation fence and owner lock,
then compares each fingerprint with the owned record under its row lock. A stale
value earns no approval. Receipts participate in acceptance replay identity. Failed
or stale operations save no approvals; ordinary edits still clear changed checks.

Telemetry span and event names are application identifiers. Put user text in content
attributes, never names or templates. Export masks content, logs and exceptions while
preserving instrumentation keys and model/provider/tool identifiers, including nested
metric dimensions. Detector discovery only receives source content, never telemetry
or model configuration. A detected word matching a model identifier must not rename it.
