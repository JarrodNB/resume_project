# Career chat

Chat is a career-focused text conversation. Users can create and reopen multiple
private conversations from the Chat page. It uses the dialogue the user provides and
read-only tools for the career library and active saved-job postings. A chat-local
`save_career_context` tool stages one user-requested new career context. Attachments
and other app actions are not available.

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
  Results are capped at 40,000 characters and keep whole entries. New fingerprinted
  approvals save with accepted replies and can be reused on later turns.
- **Allow-listed tools.** The model only sees server tools listed in `TOOL_RENDERERS`
  (`mcp_tools/client.py`), which maps each tool to its client half. A new server tool stays
  hidden from chat until it is listed there.
- **Failures.** If the server is unreachable or rejects the token, the run continues
  without tools. A database failure returns a generic tool error, and the model is told
  the library is unavailable. An empty library returns a plain sentence.
- **No sampling.** The toolset never lets the server call a model.

A reply run allows four tool calls and 12 model requests (each tool round trip is
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

Successful claim responses carry only versioned operation/conversation/user IDs,
attempt and generation fences, expected message position, summary version/checkpoint,
compaction plan and bounded settings. Rails validates accepted-history integrity and
plans compaction under its conversation lock; `ContextPlanService` returns metadata,
never copied source text. Python reads the pending message, current rolling summary
and uncovered accepted dialogue through narrow `ai_reader` column grants in one
repeatable-read transaction, checking ownership, live lease/deadline, running attempt,
positions, exact user-message screening digests and the saved summary plan. Contact
fields are read only for privacy masking. Generated replies and new summary text return
through the existing acceptance callback; source history is never echoed back.

Existing saved conversations and pending/retryable operations need no source migration:
new claims reconstruct context from their canonical records. Apply reader grants first, drain active executions, then coordinate the Rails/Python
release. The new HTTP client rejects inline legacy source claims, so mixed old/new
claim producers and consumers are unsupported; do not replay
paid operations manually. Readiness checks both chat and interview database grants.

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

Assistant replies are Markdown. The web app renders saved and streamed replies with
`react-markdown` + GFM (`ChatMarkdown`); raw HTML is dropped and unsafe link targets are
removed. User messages stay plain text. Saved content is stored as the model wrote it.

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

Successful checks carry record types, IDs and SHA-256 fingerprints of exact canonical
JSON string values per field. Chat returns these in `record_screening` on final
acceptance.
Rails accepts them only under the current operation fence and owner lock, then
`Screening::RecordApprovalsService` compares each fingerprint with the owned record
under its row lock. Chat acceptance explicitly enables owned active-job approvals after
its locked claim fences; other taskless callers can approve only career-library records. A stale
value earns no approval. Receipts participate in acceptance replay identity. Failed
or stale operations save no approvals; ordinary edits still clear changed checks.

Telemetry span and event names are application identifiers. Put user text in content
attributes, never names or templates. Export masks content, logs and exceptions while
preserving instrumentation keys and model/provider/tool identifiers, including nested
metric dimensions. Detector discovery only receives source content, never telemetry
or model configuration. A detected word matching a model identifier must not rename it.

### Active saved-job list

`list_saved_jobs()` reads only the token owner's active jobs, newest saved first with
an ID tie-breaker. Chat receives readable titles, companies and selection references,
without posting facts, raw IDs, analyses or notes. The list is complete or fails: more
than 500 jobs or 40,000 rendered characters produces a limit error. Empty lists are
explicit. Database failures return only an unavailable outcome.

Saved title/company approvals are reused; unchecked used fields are checked together
with the chat operation's accounted screen. Blocked, unavailable or oversize checks fail
the whole operation without sharing partial text. New exact field receipts return with
chat acceptance. The existing per-run cache avoids repeating reads and screening.

Selection references are 45-character signed identities, bound to the token's user and
operation and expiring with the token (at most ten minutes). All replicas share the signing
secret; references contain no source snapshots and need no in-memory registry. Detail resolution still filters by current owner and active status. The existing
four-tool-call limit supports listing, detail, career-library advice and one save together.

### Selected saved-job summary

`read_job_summary(job_reference)` resolves a list-issued reference bound to the owner,
operation and expiry, then independently reads the current owned active job. It returns
only title, company, location, requirements, responsibilities and nice-to-haves as labeled
text, with absent fields stated explicitly. Notes and generated analyses stay private.
Identical titles retain distinct references; chat asks which job when selection is unclear.
Missing/deleted/archived selections are unavailable. Invalid references and database
failures expose no database details. The complete summary must fit 40,000 characters.
Saved approvals are reused; unchecked used fields pass through the caller's accounted
screen and exact receipts return through fenced chat acceptance. Location edits discard
saved location approvals. List, summary, and career-library reads fit the four-tool reply limit with room for one save.
The eval runner serves synthetic jobs locally and never falls back to database reads.
Receipts for the same record and revision merge checked field fingerprints, keeping the
latest checked value. Listing 500 jobs then reading one summary stays within the existing
500-record acceptance bound without dropping receipts.

Chat acceptance sends at most 500 optional approval receipts across all tools. All
used fields are screened before the model sees them, including fields whose receipts
do not fit. Excess receipts are omitted from persistence only; those fields may need
screening again on a later turn. The reply and its source facts remain complete.

### Saving career context

Chat offers `save_career_context(requirement, response)` only for a user request or
agreement to save real career details. It may offer to save useful facts but must
wait for agreement. The topic/requirement interprets the response; substantive career
evidence belongs in the response because interview references display that field.
The tool cannot update or delete entries or save hypothetical assistant suggestions.

This is a chat-local proposal tool, not an MCP write. Its read-only owner-scoped
preflight returns status only: ready, already saved, topic conflict or library full.
No existing text enters the prompt through this check. Database failure produces a
truthful unavailable result while ordinary chat can continue. Topics are limited to
1,000 characters, responses to 4,000 and the library to 100 entries. Exact repeated
calls reuse one proposal; a second distinct save in the same turn is rejected.
The topic, response and entry caps come from `text_limits.py`, which mirrors Rails
`TextLimits`. Its span records only the tool version and outcome.

The proposal is attempt-local and private placeholders are restored before comparison
and transport. A successful tool call means pending, not durable. Python returns the
proposal with final reply acceptance. Rails rechecks ownership, current claim fences,
limits and uniqueness under the existing owner lock, then saves the new context,
dialogue and optional summary atomically. Identical existing topic/response is a
no-op; a different response for the same topic cannot overwrite it. If a concurrent
edit invalidates a pending save, the entire acceptance fails rather than saving a
false success reply. Streaming remains provisional until acceptance.

Proposal fields participate in acceptance replay identity. Exact accepted callback
replay creates neither another context nor another embedding job. Failed, stale,
cancelled or expired attempts save nothing. New generated fields retain approved
screening coverage; existing exact entries retain their current checks. The existing
embedding job makes new context eligible for subsequent interview preparation; already
frozen interview reference sets do not change. Future cover-letter workflows can read
the same career library without introducing a separate memory store.
