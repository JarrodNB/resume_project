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

The first two delivery slices implement persistence, lifecycle services, private HTTP
claims/recovery, and accounting. Media authorization/cleanup, Python execution and the
public demo are subsequent slices. These internal APIs grant no browser or upload authority.

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
already-authorized interview. The recording UUID is currently internal correlation only;
the media slice must authorize an owned recording before exposing submission externally.
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
history as a JSON message envelope; the future Python executor validates pinned Pydantic
message/tool structure and screened provenance before proposing it.

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

## Retention and rollout boundary

The approved media policy removes source recordings on acceptance or permanent failure,
with unaccepted recordings expiring after one hour. Generated speech lasts through the active
interview and expires one hour after completion. Dialogue/history expire after seven days;
active sessions also expire then. This slice stores the interview expiry and checks it before
submission/acceptance. Actual media cleanup and expiry orchestration belong to later slices.

The schema is additive and requires no backfill of written practice. Do not remove tables as
an operational rollback: stop the new runtime and disable creation, retaining accepted data
and accounting until an explicit data-loss decision.

## Internal execution HTTP contract

The second slice adds private Rails callbacks; it still exposes no public demo or
recording authority. `/internal/interviews/operations` is the generic shared route.
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
usage visible. Physical media deletion remains the media slice's responsibility.

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

Leases last 30 seconds, heartbeat is intended every ten seconds, and each execution has
an absolute 120-second deadline. A replacement claim increments the generation and gets a
new UUID. After lease/deadline loss, claim schedules recovery and the next discovery pass
finds it when due. There are three executions per automatic cycle and six total, with
2/5-second waits between the first three executions; the configured third 10-second
backoff is never used once the three-execution cap is reached. Explicit retry starts a
fresh bounded cycle. Turn recovery stops at the recording's one-hour lifetime. Speech
recovery stops at session expiry or one hour after completion, whichever is earlier.
Expired claims cannot heartbeat, checkpoint, accept or start another provider call.
Speech attachment/completion belongs to the media slice, which must preserve these claim
and saved-message checks; this slice intentionally has no speech completion endpoint.

## HTTP execution accounting

Each admitted logical operation links a generic `interview_turn` or `interview_speech`
AiTask without calling the SQS enqueue service. Admission acquires the owner lock before
session/question/operation/task locks. It applies the existing monthly, hourly and
in-flight limits. Retry admission rechecks monthly and in-flight limits while excluding
its own logical task and does not count another hourly task. Acceptance completes the
linked task atomically; failures/expiry update its lifecycle independently of billing.

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
