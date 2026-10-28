# Career chat

Chat is a career-focused text conversation. Users can create and reopen multiple
private conversations from the Chat page. It uses only the dialogue the user
provides: no tools, attachments, saved career-library retrieval, or app actions
are available in this delivery.

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
prompt versions, Logfire traces and actual usage. Execution and per-provider
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
