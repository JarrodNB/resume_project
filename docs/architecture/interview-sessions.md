# Interview sessions

Interview sessions own spoken interview dialogue and progress, separate from written
InterviewPrep. Basic Interview is the first supported type, exposed as a development-only demo.
The initial fixture uses fictional context, one prepared question, and at most two accepted
answers. A two-question service fixture verifies advancement. Paid providers and production
deployment are deferred.

## Ownership and transport decision

Rails owns all records and progression. The approved transport exception is a separate
FastAPI process inside `services/ai`: it claims durable operations through authenticated
internal Rails HTTP, runs asynchronously, and submits results for Rails acceptance. It does
not write the database. Browser requests never wait for the interviewer. Existing queue
features continue to use SQS and `ai_results` without changes.

The delivered foundation includes persistence, private HTTP claims/recovery, accounting,
private media services and offline audio validation. The offline runtime executes this boundary;
the owned GraphQL demo exposes accepted dialogue and safe operation progress.

## Shared domain and Basic type

`InterviewSession` owns `InterviewSessionQuestion`, `InterviewSessionMessage`, and
`InterviewSessionOperation` records through `interview_session_id`. The matching tables are
`interview_sessions` and `interview_session_questions/messages/operations`; the lifecycle
services live in `Interviews`. Existing written `InterviewQuestion` records keep their names.

The persisted `interview_type` defaults to `basic`, is required, and rejects other values in
both model validation and Postgres. No complex or interactive type is implemented. The current
slice keeps its existing two-answer constraints and fixture defaults; a future type's behavior
and corresponding constraint changes need a separate change.

## Durable domain interface

`Interviews::CreateFixtureService.call(user:, question_count: 1)` atomically saves a
session, frozen synthetic context, ordered questions, the first opening, and pending speech.
Only the service fixture permits a second question.

`SubmitTurnService.call(interview:, question_id:, recording_id:, expected_revision:,
submission_key:)` reserves one turn before acknowledging submission. Callers pass an
already-authorized interview. The recording must be ready, unexpired, owned by the same interview and current question,
and unused by another submission. An arbitrary recording UUID grants no authority.
The immutable fingerprint covers question, recording and expected revision. An identical key
and fingerprint return the original operation even after revision changes. A changed input
conflicts. Different submissions cannot share an active answer slot.

`AcceptTurnService.call(operation:, attempt_id:, claim_generation:, transcript:, decision:,
reply:, history_version:, model_history:)` commits the complete outcome under locks. It
checks current claim identity, lease, execution deadline, interview expiry and revision.
An identical accepted payload returns its saved receipt even after its lease expires;
a changed payload conflicts. Object key order does not affect the payload fingerprint.
A stale or failed operation cannot change dialogue.

Acceptance appends the answer and either a follow-up, the saved next opening, or the fixed
final closing. Rails overrides a continue decision at the answer cap and discards transition
filler on advancement. Accepted history, count, revision and new speech work commit together.
Speech refers to exactly the saved response and its question; it cannot generate dialogue.
History is private, separate from accepted public messages, versioned (currently version 1),
and bounded to 256 KiB. Transcript/reply text uses the existing prose limit. Rails treats the
history as a JSON message envelope; the Python executor validates pinned Pydantic message/tool structure and re-screens
retained untrusted history before proposing it.

## Lock order and database invariants

All lifecycle services acquire the owner row first, then interview, ordered question rows,
then operation. Acceptance locks the fixture's bounded question set before the operation,
including any next question it may introduce. New messages and speech work come last. Future
accounting and media code must preserve owner → interview → question → operation → linked
usage records → message/recording order. Never perform provider or storage I/O under locks.

Postgres enforces required fields, valid states, nonnegative counters and the two-answer
maximum. Unique indexes protect ordered question/message positions, semantic message
identity, one opening per question, one speech operation per saved message, submission keys,
and one pending/running turn per interview. Composite foreign keys keep questions, messages
and operations within the same interview and bind speech to its message's question. A running
operation needs generation/attempt/lease/deadline; an accepted operation needs a saved result
fingerprint and acceptance timestamp. Services own immutable transitions; records are not a
public editing interface.

Independent-connection specs contend real owner locks for competing submissions and
identical/conflicting acceptance. Atomicity specs inject a failed speech write and observe
unchanged dialogue, counts, history and lifecycle. Existing written-practice regressions run
alongside the new service and database-constraint checks.

## Private audio boundary

`InterviewSessionMedia` stores reservations, sealed artifacts and deletion receipts. Recording
reservation fixes the current question/revision, content type, byte count and base64 MD5.
Clients receive a PUT capability for a random staging key. Registration streams bounded bytes,
checks size, MD5, declared type and detected magic bytes, then writes and verifies a separate
sealed snapshot. Staging grants cannot overwrite that server-only sealed key. Object I/O runs
outside database locks; authority is checked again before registration commits. Existing
Active Storage uploads keep their own behavior; interview media has no public Active Storage
signed download route and accepts no caller-supplied object URL/key.

Capabilities last at most 60 seconds and never outlive media expiry. Executor recording reads
also stop at the current lease. `INTERVIEW_BROWSER_STORAGE_ORIGIN` signs browser-reachable
URLs separately from executor/server `S3_ENDPOINT_URL`; signatures are never repaired by URL
rewriting. Python uses exact configured storage origins, finite timeouts, no redirects and a
separate storage client without application credentials. Rails sets a 10 MiB maximum,
configurable downward with `INTERVIEW_RECORDING_MAX_BYTES`. Python checks expected MD5/size
and fully decodes audio before any provider call, rejecting invalid, truncated, non-audio or
overlong input. Its `MediaLimits` supports lower byte/duration bounds; duration is at most
120 seconds. The runtime wires these helpers before fake provider execution.

Speech reserves one artifact per operation/attempt and binds it to the saved message.
Registration fixes synthesized byte count/checksum and validates/seals those bytes. Completion
requires the current claim and exact saved-message identity; identical completion returns its
receipt. Playback selects only the accepted receipt's artifact through an already owner-scoped
interview, rather than choosing an arbitrary ready upload. The public GraphQL media mutations
issue short-lived upload and playback capabilities only after owner and demo-gate checks.

Local Compose stores S3Mock files in the named `s3_data` volume, sets
`COM_ADOBE_TESTING_S3MOCK_STORE_ROOT=/s3mockroot` and enables
`COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT`. Together these preserve objects across
container recreation, following the [S3Mock configuration documentation](https://github.com/adobe/S3Mock/blob/main/README.md#configuration).
S3Mock accepts presigned URLs without checking signatures or expiry, so local tests prove
Rails authorization and byte handling; production S3 capability enforcement needs its own QA.

## Retention and rollout boundary

Source recordings become expired when their turn is accepted or permanently fails; otherwise
they expire after one hour. Unaccepted speech reservations expire after one hour. Accepted
speech lasts through the active interview and at most one hour after completion, bounded by
session expiry. Read and callback services enforce these deadlines before physical cleanup.

`Interviews::CleanupService.call(limit: 10)` processes bounded batches (limit 1–100). It is
also callable through authenticated `POST /internal/interviews/cleanup`; the runtime schedules it once per minute. Deletion marks durable pending state before storage I/O and retries
failures after five minutes with a safe error code. Deleted rows retain random object keys
only as tombstones, with content metadata removed. An hourly reaper deletes those keys again:
a delayed upload grant, paused registration or crash can otherwise recreate an object after
its first deletion. Reaping has a separate bounded quota, ordered by next due time, so old
tombstones do not starve newly expired objects.

Session or user destruction first detaches media receipts in the same database transaction,
removing owner, question, message, execution identifiers and content metadata before dependent
records disappear. A database constraint allows detached rows only as key-only deletion
receipts. Bounded cleanup also selects these orphaned receipts, preserving storage retries
and late-write reaping after domain deletion. No object I/O runs in the destroy transaction.

This incurs continuing S3 delete requests; provider lifecycle rules or stronger write fencing are deferred options.

After seven days cleanup expires the session, fails pending/running linked tasks, scrubs
fixture context, dialogue, private history, accepted payloads and task input/results, and marks
content purged once. Minimal operation identities, fingerprints and billing/usage records
remain for duplicate callbacks and late accounting. Cleanup does not delete AiTask or usage
rows. These minimal records are not a retained dialogue archive.

The schema is additive and requires no backfill of written practice. Do not remove tables as
an operational rollback: stop the new runtime and disable creation, retaining accepted data
and accounting until an explicit data-loss decision. The media-detachment migration is
intentionally irreversible: detached receipts must remain collectible. Fix it forward rather
than rolling the schema back and losing those cleanup obligations.

## Internal execution HTTP contract

Private Rails callbacks expose execution and media authority to the authenticated service;
they expose no public demo. `/internal/interviews/operations` is the generic shared route.
Set `INTERVIEW_SERVICE_SECRET` to a separate random credential and send exactly
`Authorization: Bearer <secret>`. An unset credential disables these routes. Browser
cookies and caller-supplied user IDs confer no authority. Request bodies are capped at
300,000 bytes before JSON parsing, including streams without Content-Length. Callbacks
bound database lock waits to two seconds and statements to five seconds; a timeout
returns 503 with instructions to retry the identical identity. The later Python client
must also use finite connect/read timeouts and a configured Rails origin.

All callbacks receive an operation ID whose persisted session establishes its owner.
`GET /internal/interviews/operations` returns at most ten eligible IDs. Discovery retires
at most ten expired operations each pass; canonical status also retires expired work.
This releases the active-turn slot and marks linked tasks failed while leaving incomplete
usage visible. Physical media deletion runs through the cleanup service described above.

For `/internal/interviews/operations/:id`:

- `POST /claim` atomically returns `operation_id`, `kind`, `attempt_id`,
  `claim_generation`, `lease_expires_at`, `execution_deadline`, and canonical `payload`.
  A turn payload contains its recording identity, question, revision, versioned model
  history and fictional context; speech contains only saved text and its message ID.
- `POST /heartbeat` takes `attempt_id`, integer `claim_generation`, and an optional
  checkpoint: `recording_validated`, `transcribed`, `screened`, `interviewer_finished`,
  or `speech_started`. It cannot save arbitrary provisional content or extend the deadline.
- `POST /accept` takes claim identity plus the documented turn acceptance fields.
  Exact repeated acceptance returns its saved receipt even after the lease expires.
- `POST /fail` takes claim identity, a safe failure `code`, and boolean `retryable`.
  Supported codes are `dependency_unavailable`, `invalid_recording`, `screening_blocked`,
  `screening_unavailable`, `execution_failed`, `execution_timeout`, `lease_expired`, and
  `speech_failed`. Invalid recording and blocked screening are not retryable.
- `POST /retry` explicitly opens another failed-operation cycle; it cannot regenerate
  an accepted turn, revive expired media or exceed the total execution allowance.
- `GET` returns canonical status, failure/retry metadata and an acceptance receipt;
  it omits current claim credentials, recordings and model history.

The media callbacks under the same operation route take `attempt_id` and integer
`claim_generation`:

- `POST /recording` returns the current turn's sealed recording `download_url`, checksum,
  byte size, content type and expiry.
- `POST /reserve_audio` takes `content_type` and returns `media_id`, `upload_url`, required
  headers and expiry for this speech attempt.
- `POST /register_audio` takes `media_id`, base64 MD5 `checksum` and integer `byte_size`;
  it verifies and seals the uploaded speech, returning its media identity.
- `POST /complete_audio` takes `media_id` and returns the persisted media/message/claim
  identity receipt, completing speech without changing saved dialogue.

Leases last 30 seconds, heartbeat is intended every ten seconds, and each execution has
an absolute 120-second deadline. A replacement claim increments the generation and gets a
new UUID. After lease/deadline loss, claim schedules recovery and the next discovery pass
finds it when due. There are three executions per automatic cycle and six total, with
2/5-second waits between the first three executions; the configured third 10-second
backoff is never used once the three-execution cap is reached. Explicit retry starts a
fresh bounded cycle. Turn recovery stops at the recording's one-hour lifetime. Speech
recovery stops at session expiry or one hour after completion, whichever is earlier.
Expired claims cannot heartbeat, checkpoint, accept or start another provider call.
Speech attachment/completion preserves these claim and saved-message checks.

## HTTP execution accounting

Each admitted logical operation links a generic `interview_turn` or `interview_speech`
AiTask without calling the SQS enqueue service. Admission acquires the owner lock before
session/question/operation/task locks. It applies the existing monthly, hourly and
in-flight limits. Retry admission rechecks monthly and in-flight limits while excluding
its own logical task and does not count another hourly task. Acceptance completes the
linked task atomically; failures/expiry update its lifecycle independently of billing.

If admission is denied, the operation becomes `failed` with `ai_usage_limit_reached`.
It reserves no new execution/provider attempt, releases an existing task's in-flight slot,
and retains its original media-bounded retry lifetime. This stops automatic discovery from
leaving work silently pending. After the limit clears, an explicit retry rechecks allowance
before reopening the operation; accepted-answer counts remain unchanged.

A claim creates `InterviewExecutionAttempt` and an unfinished AiUsageAttempt before
execution. Before **each** potentially charged provider call, the executor must:

1. `POST /start_provider` with the current claim identity, a new `observation_id` UUID,
   `stage` (`transcription`, `screening`, `interviewer`, `speech`), `provider`, and `model`.
   Retry an ambiguous response with the same identity. Labels are immutable and bounded
   to 100 characters. The UUID binds an `InterviewProviderAttempt` to this execution and
   creates an unfinished shared ledger marker before the provider can run.
2. `POST /usage` with `attempt_id`, `observation_id`, `usage` containing one numeric
   entry, and boolean `incomplete` (default false). Supported units are `input_tokens`,
   `cached_input_tokens`, `output_tokens`, `audio_milliseconds`, `characters`, and
   `cost_microdollars`. Values are nonnegative integers up to one trillion. The server
   adds the immutable labels. Complete reports require explicit cost, including fake zero.
3. When the whole execution finishes, post `/usage` with its `attempt_id`, `usage: []`,
   and explicit completeness, omitting `observation_id`. This resolves only the execution
   marker and cannot charge provider observations again. Domain acceptance does not wait
   for this report; a missing report stays incomplete.

Provider starts are capped at `INTERVIEW_PROVIDER_ATTEMPT_LIMIT` per execution (default
eight, clamped to 1–20). Repeated identical starts still succeed at the cap. Separate
provider executions require separate observation UUIDs. Duplicate finalized reports never
add cost twice. Persisted matching stale-execution observations can still report charges,
including after domain acceptance; they cannot change dialogue or current claims. Missing
observations remain unknown rather than silently becoming known zero. A completed
execution marker does not resolve its unfinished provider markers.

## Offline runtime

`interviews.app:app` is a separate FastAPI process. Its lifespan owns a supervised
recovery loop, discovering every two seconds in batches of ten and running at most
two claims at once. Each execution renews its 30-second Rails lease every ten seconds;
Rails retains the 120-second deadline and all retry limits. A lost heartbeat stops
local execution. Shutdown stops discovery and cancels active work, leaving durable
leases for another process. Cleanup runs in bounded Rails batches every minute.
`GET /health` reports liveness; `/ready` requires enabled configuration and recent
successful Rails discovery. Neither health route consumes work.

The Compose `interview-demo` profile explicitly enables fake execution. Set the same
`INTERVIEW_SERVICE_SECRET` in the Compose environment for Rails and the runtime.
The runtime deliberately does not load the worker `.env`, use worker startup,
resolve provider model names, or configure tracing. Real Pydantic model requests and
remote OpenTelemetry/Logfire export are disabled in this process. Existing SQS workers
keep their settings and transport. Production runtime/provider deployment is deferred.

The Rails client uses an exact configured origin, dedicated service authentication,
bounded request/response bodies, no redirects or environment proxies, and finite
request deadlines. Callback retries keep the same serialized identity; ambiguous
claims are not repeated. Storage has its own unauthenticated client and explicit
allowed origins, so Rails credentials never reach capabilities. Full audio decoding
runs off the event loop so lease renewals remain responsive.

Fake transcription is scripted and does not interpret recordings. Fake screening uses
injected classifiers through the shared policy. The interviewer uses the pinned
Pydantic AI FunctionModel, official input guardrail and typed restored history;
`advance_to_next_question` returns intent for Rails to apply. Each fake stage is
registered before execution and reports explicit zero cost. Saved-text speech uses
four fixed synthetic eSpeak WAV fixtures, generated offline at 155 words per minute;
unknown text has no fallback synthesis. Their text mapping lives in
`interviews/fake.py`. These fixtures exercise real upload, sealing and playback.

Run the dependency image and focused offline checks from this checkout:

```bash
docker compose build interview-runtime
docker compose run --rm --no-deps interview-runtime pytest -m 'not db' tests/test_interview_runtime.py tests/test_interview_client.py tests/test_interview_executor.py tests/test_interview_media.py
```

For a local backend smoke check, start Rails/database/storage and the runtime with
`docker compose --profile interview-demo up -d api s3 interview-runtime`, then run
`docker compose run --rm api bundle exec rails runner script/interview_runtime_smoke.rb`.
The script creates a fictional disposable account, submits two generated WAV inputs,
waits for accepted dialogue and attached speech, checks accounting and removes the
account. It requires development mode and the service secret. It does not perform
browser QA or prove provider quality. Use a unique Compose project and port overrides
when another stack is running; `docker compose -p <project> down` stops that stack.

## Public development demo contract

`INTERVIEW_DEMO_ENABLED=true` enables the surface only when Rails runs in development.
The default is disabled. `interviewDemoEnabled` lets the authenticated UI discover this gate;
every query, mutation, and subscription checks it independently. `startInterviewDemo` creates
fictional context; `interviewSession(id)` and `interviewSessionUpdated(id)` read through the
current user's sessions. Initial subscription delivery and reconnect return a fresh snapshot.
Expired sessions reject reads immediately, even if scheduled cleanup has not run.

`authorizeInterviewRecording`, `registerInterviewRecording`, `submitInterviewTurn`,
`retryInterviewOperation`, and `interviewPlayback` delegate to the existing owned lifecycle
and media services. Upload grants and playback URLs appear only in those explicit responses,
never in snapshots. Snapshots include saved public messages, question counts, revision,
operation status, safe checkpoints/failure codes, and submission keys for ambiguous-submit
reconciliation. They omit model history, context snapshots, recording IDs, claim credentials,
provider payloads, storage keys, and accepted-result internals.

Session, question, message, and operation changes publish after commit. Rollback publishes
nothing; delivery failure leaves durable state available through query/reconnect. Multiple
notifications can describe the same revision, so clients reconcile snapshots by session
identity and reload when connection delivery is uncertain.

The React entrypoint is `/interviews/demo` (and `/interviews/demo/:id` for reloads).
Set `VITE_INTERVIEW_DEMO_ENABLED=true` explicitly for the development web server as well
as `INTERVIEW_DEMO_ENABLED=true` for Rails. Compose passes both settings with false defaults.
Production builds hide the route content even if the frontend flag is set; Rails independently
denies public demo operations outside development. Written practice remains at `/interview-prep`.

The browser selects supported WebM/MP4 recording, stops the microphone with **Done answering**,
and submits only after that explicit action. Permission, format, disconnect, size and time-limit
errors discard or preserve bytes as appropriate without submitting. A pre-submission upload failure
keeps the recording for an explicit retry. Once a durable submission identity is saved, the browser
may release its bytes even if the response is lost. Only that minimal question/recording/revision/key
identity is kept in local storage, scoped by owner and interview; a successful owned read reconciles
it before an explicit same-key resend. No mutation is automatically replayed after an auth error.
Queries on mount and fresh subscription snapshots on reconnect restore canonical progress without
polling. Playback obtains a fresh grant for the same saved message; it never retries reasoning or
speech generation. Expired grants can be renewed while the artifact itself remains retained.

For browser-reachable local storage, Compose defaults `INTERVIEW_BROWSER_STORAGE_ORIGIN` to
`http://localhost:9090`; override it when QA uses a different published storage port. The direct
PUT uses exactly the signed headers and never sends account cookies. The isolated stack checks
real S3Mock PUT/GET/HEAD preflight responses. Actual browser upload, microphone and playback
behavior still need human QA; frontend automated checks use browser resource fakes.

The [isolated demo and recovery guide](../interview-demo.md) provides a standalone fake-only
stack and real-process restart checks without loading provider credentials. Its optional QA
overlay uses a separate loopback host, aligned CORS/storage origins, and persistent volumes;
keep manual microphone/playback checks separate from automated recovery assertions.
