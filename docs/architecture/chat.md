# Career chat

Chat is a career-focused text conversation. Users can create and reopen multiple
private conversations from the Chat page. It uses the dialogue the user provides and
read-only tools for the career library, active saved-job postings and saved interview
practice questions (a list, and one selected question with its answer and current
feedback). A chat-local
`save_career_context` tool stages user-requested new career contexts. Attachments
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
  without tools. When a result can't be used (a failed read, a blocked or unavailable
  check, or a limit), `mcp_tools/client.py` gives the model a plain sentence naming the
  reason and the reply continues. Only the user's own new message can fail a turn as
  `screening_blocked`. An empty library returns a plain sentence.
- **No sampling.** The toolset never lets the server call a model.

A reply run allows 16 tool calls and 12 model requests (each tool round trip is
another request). Text written before a tool call is kept: the saved reply joins the
text of every model response in the run, so it always matches what was streamed.
Repeated calls with the same arguments in one run reuse the first result.

## Ownership and execution

Rails owns conversations, accepted messages, pending operations, summary checkpoints
and feedback. Authenticated GraphQL reads and mutations scope every conversation to
its owner. Conversation and message history use bounded, signed cursor pages.
Conversation lists and study-guide history share
`Pagination::ReadCreatedPageService` for signed creation-time/id pagination.
Feature services supply authorized relations, cursor scope, page size and
presentation; the shared module owns verification, ordering and continuation.
Existing purpose strings and cursor payloads remain valid. Position-based chat
message history keeps its own pagination.
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

Streaming is always on. Configure the existing
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

`read_career_library-v4` returns the complete library or a plain sentence saying why it
can't be shown. Each
collection and nested highlight list is capped at 500 items; preparation also caps
the total entries plus highlights at 500 and serialized source text at 80,000
characters. Database reads fetch at most 501 rows per collection to detect overflow
without loading an unlimited list. Chat checks the full rendered result against
40,000 characters before classification. No oversized list or result is truncated.

Pending fields are checked together as labeled plain text through the existing
bounded screening/chunking policy. Approved fields need no classifier call. A blocked,
unavailable or oversized library shows none of its text; there is no per-entry retry or
partial answer. Classification fallback for a provider outage retains the shared
screening deadline and accounting policy.

Successful checks carry record types, IDs and SHA-256 fingerprints of exact canonical
JSON string values per field. Chat returns these in `record_screening` on final
acceptance.
Rails accepts them only under the current operation fence and owner lock, then
`Screening::RecordApprovalsService` compares each fingerprint with the owned record
under its row lock. Chat acceptance explicitly enables owned active-job and owned
active interview-question approvals after its locked claim fences; other taskless callers
can approve only career-library records. A stale
value earns no approval. Receipts participate in acceptance replay identity. Failed
or stale operations save no approvals; ordinary edits still clear changed checks.

Telemetry span and event names are application identifiers. Put user text in content
attributes, never names or templates. Export masks content, logs and exceptions while
preserving instrumentation keys and model/provider/tool identifiers, including nested
metric dimensions. Detector discovery only receives source content, never telemetry
or model configuration. A detected word matching a model identifier must not rename it.

### Active saved-job list

Each reply hydrates the owner's five most recent active saved jobs in the same
read-only transaction as accepted dialogue, ordered by saved time and then ID.
The prompt includes readable titles, companies and operation-bound selection references,
never raw IDs. Each job's labels are checked on their own with the operation's accounted
screen, reusing saved approvals. A blocked, unchecked or oversize job is left out with a
note, and the reply continues. Labels skip local
person detection, like tool results, so company names are not mistaken for people.
Context is refreshed each turn, masked with known contact and any values detected in the
dialogue, bounded and omitted from rolling summaries.
The model can answer recent-job questions or read their details without first listing.
It uses `list_saved_jobs` for older selections or the complete list.

`list_saved_jobs()` reads only the token owner's active jobs, newest saved first with
an ID tie-breaker. Chat receives readable titles, companies and selection references,
without posting facts, raw IDs, analyses or notes. The list is complete or not shown: more
than 500 jobs or 40,000 rendered characters produces a limit sentence. Empty lists are
explicit. Database failures return only an unavailable outcome.

Saved title/company approvals are reused; unchecked used fields are checked together
with the chat operation's accounted screen. Blocked, unavailable or oversize checks return
a plain sentence to the model without sharing partial text, and the reply continues. New exact field receipts return with
chat acceptance. The existing per-run cache avoids repeating reads and screening.

Selection references are 45-character signed identities, bound to the token's user and
operation and expiring with the token (at most ten minutes). All replicas share the signing
secret; references contain no source snapshots and need no in-memory registry. Detail resolution still filters by current owner and active status. The existing
16-tool-call limit supports reads and multiple authorized saves together.

### Selected saved-job summary

`read_job_summary(job_reference)` resolves a reference from the current prompt or list, bound to the owner,
operation and expiry, then independently reads the current owned active job. It returns
only title, company, location, requirements, responsibilities and nice-to-haves as labeled
text, with absent fields stated explicitly. Notes and generated analyses stay private.
Identical titles retain distinct references; chat asks which job when selection is unclear.
Missing/deleted/archived selections are unavailable. Invalid references and database
failures expose no database details. The complete summary must fit 40,000 characters.
Saved approvals are reused; unchecked used fields pass through the caller's accounted
screen and exact receipts return through fenced chat acceptance. Location edits discard
saved location approvals. List, summary, and career-library reads fit the 16-tool reply limit with room for multiple saves.
The eval runner serves synthetic jobs locally and never falls back to database reads.
Receipts for the same record and revision merge checked field fingerprints, keeping the
latest checked value. Listing 500 jobs then reading one summary stays within the existing
500-record acceptance bound without dropping receipts.

Chat acceptance sends at most 500 optional approval receipts across all tools. All
used fields are screened before the model sees them, including fields whose receipts
do not fit. Excess receipts are omitted from persistence only; those fields may need
screening again on a later turn. The reply and its source facts remain complete.

### Saved practice-question list

`list_interview_questions-v1` (`mcp_tools/interview_questions.py`) lists the token
owner's active interview practice questions: retired copies of replaced slots are left
out in SQL (`database/interview_question_bank.py`, joined to the owner's sets). Order is
newest practice set first (set created time, then ID), then slot. Each entry shows the set
number and readable set type (for example "Fit and motivation"), slot, question text,
whether an answer is saved, the feedback status and a question reference. Answers,
feedback text and raw IDs are not returned.

Feedback is "current" only when saved feedback is non-empty and its question and answer
revisions equal the question's current ones (a format change always bumps the answer
revision, so this also covers the answer-format revision). Otherwise saved feedback is "out of date"; no feedback is "none".
This is stricter than the app's `FeedbackOutdatedService`, which also accepts
formatting-only answer edits by reading the review task; chat says "out of date" there.

The list keeps the newest whole questions that fit 40,000 rendered characters (about 150
questions) and at most 500, and says how many older ones are not shown; only screening
those kept. One question too large to show on its own produces a limit sentence. An empty
bank is stated plainly. Database failures return only
the short `interview_questions_unavailable` error, which the model sees as a plain sentence.
Saved `question_text` approvals are reused; unchecked questions are screened together with
the operation's accounted screen. If that batch is blocked, it is split in halves to find
the blocked questions (about two checks per halving level, not one per question, and at most
24 extra checks per list); blocked ones are left out with a note and the rest are still
listed. If a rejected batch's halves each pass alone, the batch stays blocked, since the
classifier rejected that combined text. A sub-batch whose check could not finish, or that
the extra-check limit did not reach, is left out whole with a separate "could not finish" note. Unavailable screening
for the first batch shows none of the list. Receipts carry the question revision; Rails approves
them only for the owner's active questions whose current text and revisions still match.

Question references use the shared signer in `mcp_tools/references.py`, like job
references, but with their own `Q-` prefix and scope string, so a job reference never
resolves as a question. The chat eval runner serves synthetic questions from the local
tool server and records which tools' readers ran for its `tool_use_policy` check.

### Selected saved practice question

`read_interview_question(question_reference)` (`read_interview_question-v1`, same file as
the list) resolves a `Q-` reference from `list_interview_questions` in this operation, bound
to the owner, operation and expiry. Job references, malformed or expired references and
references from another user or operation are refused with the short
`interview_question_unavailable` error before any read; database failures return the same
code. It then independently reads the owner's active question
(`database/interview_question_bank.py`); a missing, retired or other-owner question is
"no longer available". It never reads answer drafts.

The labeled text shows the set number and type, slot, question, answer format (Plain text,
STAR, CAR or CARL) and the saved answer, which is already stored in its selected format
with labeled parts such as "Situation: ...", or "No answer saved yet". Saved feedback
(strengths, improvements and example answer; evidence quotes are left out) is shown only
when it is current by the list's rule. Otherwise a sentence says the feedback is out of date
and not shown, or that there is none. The whole result must fit 40,000 characters.

Saved `question_text` and `answer_text` approvals are reused; unchecked ones are screened
together with the operation's accounted screen. Feedback is model-generated text Rails stored
after review, so it is not screened again. A blocked or unavailable check shows none of the
entry. The question's receipt carries its question revision (so a check made by the list
is reused); the answer's receipt carries both question and answer revisions, and Rails
approves `answer_text` from chat only when both still match. Chat is told to read a
question before critiquing its saved answer and to ask which one when several could match.

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
calls reuse the same proposal; distinct authorized facts are staged as separate entries
in one turn. A repeated topic with different text is rejected.
The topic, response and entry caps come from `text_limits.py`, which mirrors Rails
`TextLimits`. Its span records only the tool version and outcome.

The proposals are attempt-local and private placeholders are restored before comparison
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


Acceptance carries a `career_contexts` array (at most the 100-entry library cap).
Rails rechecks all topics and total capacity under the owner lock, then saves the
entries and dialogue atomically. Conflicts or insufficient space reject the entire
acceptance, including earlier entries. Exact accepted replays create no duplicates
or additional embedding jobs. The singular `career_context` request remains supported
for older workers; requests containing both forms are rejected. Deploy Rails before
workers that send the array. Multiple entries remove the extra confirmation turn
when a user has already authorized saving several stories.
