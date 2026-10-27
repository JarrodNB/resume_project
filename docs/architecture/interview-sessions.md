# Interview sessions

Interview sessions own spoken interview dialogue and progress, separate from written
InterviewPrep. Basic Interview is the first supported type in the app.
New sessions prepare 5, 8 or 12 typed main questions from the owner's career library,
using either an owned saved job or a fictional role, then begin explicitly after review. Each question allows at most three accepted
answers. Older fixture sessions keep their one/two questions and two-answer cap. Real providers
run in the normal local Compose stack when its credentials are configured.

### Saved-job practice

The job page's **Practise interview** action opens `/jobs/:jobId/interview`. Setup loads
the owned job from the route and retains the existing round and microphone choices.
`startInterviewDemo` accepts an optional `jobId`, resolved through `current_user.jobs`;
no job text is accepted from the browser. Career-library evidence remains required,
and comparison/resume generation is not a prerequisite. The action does not change
application stage. Library-only starts retain fictional-role preparation.

Rails freezes the job's identity, title, company, description, requirements,
responsibilities and nice-to-haves in `frozen_context.job`. The same private context's
`sources` includes separate `jobs` entries with exact typed values, readable text and
screening flags. These share the existing fenced source-index receipt. Matching saved
approvals are reused; newly approved frozen values update live job approvals only if
the owned, locked field still matches. Editing description/responsibilities also clears
their approvals. Missing job fields stay missing, and required oversize context fails
without truncation. Notes, gap responses and tailored resumes are excluded.

Readable model context renders **Saved job expectations** separately from **Candidate
career evidence**. Job preparation returns questions with `role: null`; Rails rejects
model-authored job roles and derives its saved role summary from the authoritative
snapshot. Generic preparation still requires a valid generated fictional role. The
unchanged version-one turn envelope carries the full frozen context in its legacy
`personal_evidence` key, including the separate job branch; the formatter excludes job
sources from candidate evidence and does not present that key as a personal claim.
The job snapshot remains the authority for preparation and subsequent follow-ups.

The public `jobContext` field exposes only the session's saved vacancy details, with
a nullable live job id. Deleting the job nulls the optional association without deleting
practice; edits do not change frozen details. Normal expiry cleanup purges the copied
context and prepared role with other session text. Title-only jobs show limited-context
copy and use broader role questions rather than invented vacancy requirements.

Recent interviews identify saved-job practice using its frozen title/company. Preparation,
active sessions and completed reviews retain that identity and offer a return link only
while the original job exists. Repeating completed practice carries the saved choices to
the same job's setup; deleted sources instead offer an explicit choice of another job.
Job deletion detaches live retained sessions through normal snapshot callbacks under the
existing owner/job locks. This updates live navigation without changing progression revision,
accepted dialogue or pending answer identity. A rejected deletion rolls back the detachment.

Job setup checks `unfinishedInterviewSession` before enabling preparation. This owner-scoped
read uses the same live preparing/ready/active, nonempty-context scope as admission, rather
than the latest twenty history entries. An unfinished round offers explicit resume and
confirmed cancellation/abandonment. Ending it keeps the selected job and every current
setup choice; preparing another round still requires a separate user action.
Failed or uncertain start replies trigger a read of saved state, never an automatic replay
of the start mutation. A failed state read keeps preparation disabled until an explicit
successful check. The setup also offers another saved job and manual reload after a failed
job read; an unavailable source never falls back to fictional-role preparation. These
recovery reads are on demand and do not poll or execute provider work.

Frozen setup also records difficulty (Warm-up, Realistic or Stretch), interviewer
(Maya, Daniel or Priya), and optional allowlisted focus areas. New and older sessions
default to Realistic, Daniel and no focus when those fields are absent. Preparation
and turn claims carry the same saved choices. Focus biases questions within the selected
format; it never replaces the format or supplies career evidence. Maya is warm without
coaching or grading; Priya asks direct, specific follow-ups after submission and never
interrupts live answers. Personas retain the existing British speech voice, factual
acknowledgements, screening and answer limits.

The spoken start route lists the owner's latest 20 unexpired real sessions in preparing,
ready, active or completed states. Preparing/ready sessions reopen their saved preparation
or role review; active sessions restore accepted dialogue and progress; completed sessions
reopen for review. Scripted fixtures and abandoned/expired sessions do not appear in this list.

Candidate input supports browser recognition (the default), live provider transcription,
and complete-recording transcription. The owner-scoped browser preference is independent
of interviewer speech playback. Typed answers submit reviewed text directly without a recording. They use the explicit
`typed` input mode, preserve the exact text through screening and acceptance, and never
request an audio grant or transcription. Any attached recording still requires owned ready
media validation. Historical recorded/browser/streaming submissions retain their recording
checks; a missing recording in those modes is invalid. Text-only operation recovery ends at
one hour or session expiry, whichever comes first. The room uses review-first input for
all voice modes: finalized dictation or complete-recording transcription fills the editable
answer box, and explicit Submit sends the reviewed text through the typed contract.
A separate `transcription` operation binds complete audio to its owned current question and
revision. The HTTP recovery worker downloads only sealed object grants, validates the audio,
and uses the existing accounted transcription provider. Acceptance saves private capture text
without creating dialogue, incrementing revision, or consuming an answer. Subscription
snapshots expose that text only while the interview, revision and recording remain live.
Cancellation fences late results and expires the audio; cleanup and abandonment scrub capture
text while retaining usage identities. Retries share the existing execution bounds. Historical
audio-turn callers keep their recording validation and transcription behavior. See
[answer transcription](../interview-transcription.md) for lifecycle and device checks.

An explicit confirmed abandonment ends a preparing, ready or active session. Under the
owner/session locks it increments the revision once, expires unfinished operations, releases
their task slots and invalidates all media. Repeating abandonment returns the same saved
terminal snapshot. It never deletes logical tasks, execution/provider identities, known charges
or unknown usage. New claims, provider starts (including repeat start receipts), heartbeats,
retry, media grants, registration and completion cannot continue abandoned work. Late usage
reports and harmless saved acceptance receipts remain readable. Existing accepted dialogue
remains until normal content expiry; abandonment does not create a restart or skip action.

## Ownership and transport decision

Rails owns all records and progression. The approved transport exception is a separate
FastAPI process inside `services/ai`: it claims durable operations through authenticated
internal Rails HTTP, runs asynchronously, and submits results for Rails acceptance. It does
not write the database. Browser requests never wait for the interviewer. Existing queue
features continue to use SQS and `ai_results` without changes.

The delivered foundation includes library-informed preparation, persistence, private HTTP claims/recovery, accounting,
private media services and offline audio validation. The offline runtime executes this boundary;
the owned GraphQL demo exposes accepted dialogue and safe operation progress.

## Shared domain and Basic type

`InterviewSession` owns `InterviewSessionQuestion`, `InterviewSessionMessage`, and
`InterviewSessionOperation` records through `interview_session_id`. The matching tables are
`interview_sessions` and `interview_session_questions/messages/operations`; the lifecycle
services live in `Interviews`. Existing written `InterviewQuestion` records keep their names.

The persisted `interview_type` defaults to `basic`, is required, and rejects other values in
both model validation and Postgres. No complex or interactive type is implemented. New prepared sessions save cap three explicitly; the database default remains two for
legacy fixtures. Model and database upper bounds are three without rewriting old records.

## Saved execution mode

Rails saves immutable `execution_mode` and `execution_config` on each session.
Existing rows and default fixture creation use `fake`, with versioned fake model
names and the eSpeak fixture voice. Internal fixture creation may save the approved
`real` preset (gpt-transcribe, gpt-6-luna, gpt-4o-mini-tts and marin). Public creation
defaults to real and rejects fake/unknown modes. Scripted sessions are retired in the UI;
their stored modes and data remain unchanged. Offline test fixtures still use fake providers.
Model names and voice never come from browser input.
Database constraints reject unapproved mode/configuration combinations. Rails readonly
attributes reject configuration edits after creation; direct database maintenance must
preserve that invariant. Future presets must retain old saved presets as valid.

Discovery takes `execution_mode` and filters both cleanup candidates and eligible work.
Claim takes the same mode and checks the persisted session while holding its locks,
before expiry, lease recovery, admission or accounting changes. Omitted mode means
fake for compatibility with existing offline clients. Unknown modes fail clearly.
Turn, opening/reply speech, retries and recovery all retain the same owning session's
configuration. Claims return typed `execution_mode` and `execution_config`; public
owner-scoped snapshots expose only the mode. These labels are scheduling isolation,
not separate authorization credentials: internal callbacks still require the service secret.

Rollback disables admission of new real sessions and retains saved real work for a
compatible real runtime to resume or cleanup to retire. Never convert real sessions to
fake or deploy an older fake-only runtime against them. Real browser QA uses the original
paid verification database and its cumulative ledger, not a new per-QA allowance.

## Durable domain interface

### Library-informed preparation

Public creation now starts durable preparation instead of creating the fixture opening.
`StartPreparationService` freezes only owned usable career-library text and its source
identity, plus an optional career focus of at most 200 characters. Job-derived library-fact
requirements are excluded. Sparse library content is usable; an empty library or a snapshot
over 40,000 JSON bytes returns an actionable error without creating work. Later library edits
cannot change a saved preparation's input. Raw frozen sources remain private.

A `preparing` session has one `preparation` operation with no question, recording or message.
The existing private discovery, lease, heartbeat, failure, retry and accounting contracts
apply. The preparation claim contains `frozen_context` and the immutable candidate `setup`;
it requires no storage capability. New starts default to eight main questions and accept only
5, 8 or 12. Rails saves this separately from provider execution configuration in `setup_config`;
public snapshots expose the safe setup, so reload and retry preserve the selected length.
The setup also freezes `question_format`: Mixed cycles behavioral/technical/knowledge;
Behavioural uses behavioral questions only; Technical / Role alternates technical and knowledge;
HR Screening uses the explicit screening category for motivation, background, logistics and
culture fit. Both Python and Rails validate the saved count and exact ordered categories.
Missing format in an older length-only setup means Mixed. This question format does not change
the Basic session type or the saved response cap.
Existing sessions with empty saved setup keep their nine-question preparation policy. No
backfill changes their questions, dialogue or progression. Follow-ups are extra; the length's
10/20/30-minute estimates are approximate rather than session deadlines.
The real executor screens/masks that source, runs a guarded Pydantic AI preparation agent
through the accounted approved Luna model, and posts `accept_preparation` with claim identity,
`role` and `questions`. Preparation uses the existing interviewer accounting stage, with a
4,096-output-token cap so the complete question plan fits; dialogue remains capped at 1,024.

Rails validates a short fictional role (title, responsibilities and requirements) and exactly
the saved number of distinct main questions, using the chosen format's ordered categories.
The Python preparation agent validates the same saved count and sequence before returning it. Acceptance
atomically saves the entire role and question list, marks the operation accepted and session
`ready`, and creates no opening or speech. Identical receipt replay returns the saved result;
changed output or a stale generation cannot replace it. Failure leaves no partial question
list, and bounded retries reuse the same frozen input. `BeginService` (the owned public `beginInterview` mutation) changes ready to active and saves
the first opening atomically, plus one speech operation only in provider playback mode. Concurrent/repeated begin returns
the saved state without duplicate messages or speech. Begin can also replay after progress
or completion. Expired and not-yet-ready sessions cannot begin; role review alone creates no
speech or recording.

Public snapshots expose the prepared fictional role and safe preparation progress, never
raw personal source snapshots or execution credentials. Question type is persisted separately
from its position. Existing fixture sessions, their two-answer caps and saved configurations
are preserved; the fixture service remains available to deterministic tests.

Seven-day expiry retires preparation and scrubs frozen sources and generated role along with
dialogue/history, retaining the existing accounting markers. Preparation does not create
career-library facts, saved jobs, coaching or assessment. Automated interview-quality
evaluators remain deferred; offline tests establish contracts rather than generated quality.

### Begin and active-turn interfaces

`Interviews::CreateFixtureService.call(user:, question_count: 1, execution_mode: "fake")` atomically saves a
session, frozen synthetic context, ordered questions, the first opening, and pending speech.
The service fixture remains a legacy offline seam with one or two questions. Public prepared
sessions conduct their saved number of main questions, preserving their chosen question format.
The room keeps the current question and earlier history visible without adding response counts.

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
filler on advancement. Accepted history, count, revision and any enabled provider speech work commit together.
Speech refers to exactly the saved response and its question; it cannot generate dialogue.
History is private, separate from accepted public messages, versioned (currently version 1),
and bounded to 256 KiB. Transcript/reply text uses the existing prose limit. Rails treats the
history as a JSON message envelope; the Python executor validates pinned Pydantic message/tool structure and re-screens
retained untrusted history before proposing it.

Prepared turn claims carry versioned `interview_context`: `personal_evidence` is the original
frozen source snapshot (including provenance/contact masking inputs), while `fictional_role`
is the imagined vacancy. These sources stay distinct in the prompt so vacancy requirements
cannot become personal facts. Legacy turn claims retain `fixture_context`; Python accepts
exactly one of the two sources. Frozen context and current-question private history are
bounded and freshly screened before dispatch, with contact masking preserved. Earlier-question
dialogue is not included yet; it belongs to the following context slice.

## Lock order and database invariants

All lifecycle services acquire the owner row first, then interview, ordered question rows,
then operation. Acceptance locks the fixture's bounded question set before the operation,
including any next question it may introduce. New messages and speech work come last. Future
accounting and media code must preserve owner → interview → question → operation → linked
usage records → message/recording order. Never perform provider or storage I/O under locks.

Postgres enforces required fields, valid states, nonnegative counters and the three-answer
maximum. Saved session caps still determine advancement. Unique indexes protect ordered question/message positions, semantic message
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

### Acknowledgements and canonical interviewer text

Real interviewer output carries a required acknowledgement of at most 280 characters,
separate from its follow-up or advancement intent. It is one brief factual sentence
about the newest candidate answer, without praise, scoring, coaching or invented facts.
Rails saves it on the accepted follow-up, next opening or final closing, including when
the response cap forces advancement. It never changes Rails' choice of question.

Message `content` remains only the question/follow-up/closing. Optional
`acknowledgement` metadata is exposed separately; `spokenContent` joins it to content
with a blank line. Browser and provider speech use that canonical saved text, as do
restored public-dialogue claims. Clarification can read content alone without copying
candidate details from the acknowledgement. No new dialogue kind is introduced.
Acknowledgement plus follow-up share the existing 4,000-character speech-text cap.

Internal acceptance permits omission for historical runtimes and old receipts. An
omitted acknowledgement leaves historical fingerprints unchanged, while an included
acknowledgement participates in duplicate-result conflict detection. New real model
output must provide a nonblank acknowledgement. Parameter logging filters it like
reply text; expiry cleanup scrubs it with the rest of the private dialogue.

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
Abandonment immediately marks audio for deletion and denies fresh application access,
including accepted playback. URL signing runs outside locks and rechecks authority before
returning a grant. A URL already returned before abandonment can remain usable until object
deletion or its short expiry; durable cleanup and late-write reaping remove the objects.

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

After seven days cleanup expires the session (preserving an abandoned terminal status), fails pending/running linked tasks, scrubs
fixture/frozen context, prepared role, dialogue, private history, accepted payloads and task input/results, and marks
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
- Frozen career sources include private per-field `screened` metadata. Creation copies
  existing field approvals; legacy claims reuse a current owned approval only when the
  exact field value equals the frozen source. Frozen text and source order do not change.
  A turn claim also carries `current_dialogue`, the Rails-owned opening/answer/follow-up
  messages for its current question in chronological order, separate from private model history.
- `POST /screen_library` takes current claim identity and `source_indices`, positions in
  that immutable source list. After successful screening, it durably approves those frozen
  values before model generation and returns all `screened_source_indices`. Repeated calls
  while the claim is current are idempotent. Live library fields earn approval only under
  record locks when the owner and exact current value still match; edits or deletions cannot
  accidentally approve new text. Preparation may also submit optional `career_focus_sha256`,
  the SHA-256 of the exact frozen focus encoded as UTF-8 JSON without ASCII escaping or
  extra whitespace (Python `json.dumps(..., ensure_ascii=False, separators=(',', ':'))`,
  Ruby stdlib `JSON.generate`). Rails validates it against the locked nonempty focus before
  any source writes and stores/returns `screened_career_focus_sha256`. Focus-only requests
  use `source_indices: []`; turn claims cannot grant focus checks. Source-only requests
  retain their existing response shape. This callback does not change general AI-result screening.
- `POST /heartbeat` takes `attempt_id`, integer `claim_generation`, and an optional
  checkpoint: `recording_validated`, `transcribed`, `screened`, `interviewer_finished`,
  or `speech_started`. It cannot save arbitrary provisional content or extend the deadline.
  A checkpoint-free heartbeat from the exact accepted execution returns
  `{ execution_finished: true }` without renewing its lease. A matching failed or
  retry-pending execution can return the same receipt while its original lease and
  deadline remain valid. Unfinished expired claims, replaced identities, abandoned or
  expired sessions, and checkpoint writes after completion remain rejected; a finished receipt never authorizes another provider call.
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

Preparation creates its `interview_preparation` AiTask in the same transaction as the
session and operation, before acknowledging creation. This task is the session's one
hourly admission. Each later turn or speech keeps a separate AiTask, linked immutably to
that preparation task through `hourly_admission_task_id`; no SQS message is published.
The allowance module verifies the persisted owner, session, preparation identity and
operation purpose before creating or reusing a child task. Missing or forged prepared-session
admission fails closed. Existing fixture operations use the interview allowance but retain
their individual hourly admissions. General AI tasks use a separate allowance.

Spoken interviews have their own per-user limits: **$3/month**, **30 session starts/hour**, and
**three concurrent operations**, configured by `INTERVIEW_MONTHLY_BUDGET_USD`,
`INTERVIEW_SESSIONS_PER_HOUR`, and `INTERVIEW_MAX_IN_FLIGHT_OPERATIONS`. General AI usage and
its per-user override columns do not consume or change these limits. Conversely, spoken
interview preparation/turn/speech costs, hourly starts and in-flight tasks do not consume
general AI allowances or appear in the general `me { aiUsage }` summary. Written interview
question practice remains in the general bucket. No bills or unknown markers are removed.

Only hourly admission groups interview stages: interview monthly spend sums every spoken
stage task, and interview concurrency counts every recently queued spoken task. A claim
excludes only its own task from concurrency, never the preparation root or another operation.
Claims, explicit retries and every provider start recheck the interview allowance. New child
creation and admission rejection commit together, leaving no execution/provider attempt on
denial. The global retained paid-verification allowance and new-unknown stop remain unchanged.
The current monthly accounting policy remains task-creation-month attribution, including
late retry charges. New child tasks use their creation month; sharing an older hourly root
does not move new task bills into that root's month. This change does not rewrite historical
or unrelated task accounting.

The owner lock admits at most one unexpired preparing/ready/active **prepared** session per
user. Resume or abandon it before preparing another; completed, expired and abandoned
sessions do not occupy that slot. A prepared question permits six distinct submitted
recordings, including failures, independently of its three-accepted-answer cap. Retrying
the same operation or replaying its submission key does not use another recording slot.
Thus a twelve-question interview permits at most 72 turn operations, 37 saved-message speech
operations in provider playback mode and one preparation operation; existing six-execution and
per-execution provider caps remain. The earlier-dialogue claim permits up to eleven complete
question groups or omitted positions while retaining the existing 12,000-character budget.
Failed inputs never increment accepted-answer counts. When the submission cap is exhausted,
the user must abandon and prepare another session under ordinary new-session admission.

Admission acquires the owner lock before session/question/operation/task locks. Acceptance
completes the linked task atomically; failures/expiry update its lifecycle independently
of billing. Account destruction may null a child-to-root reference but never cascades
through it to delete another task's usage or the permanent verification ledger.

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
local execution. A finished-execution heartbeat ends renewal and lets the executor's
bounded final acceptance/accounting response finish; it does not cancel an already
accepted turn while awaiting its final usage receipt. Shutdown still cancels that wait.
Shutdown stops discovery and cancels active work, leaving durable
leases for another process. Cleanup runs in bounded Rails batches every minute.
`GET /health` reports liveness; `/ready` requires enabled configuration and recent
successful Rails discovery. Neither health route consumes work.

The fake runtime is retained only in the isolated offline recovery harness; its former
root Compose `interview-demo` profile has been removed. The offline runtime deliberately
does not load the worker `.env`, use worker startup,
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
docker compose build ai
docker compose run --rm --no-deps ai pytest -m 'not db' tests/test_interview_runtime.py tests/test_interview_client.py tests/test_interview_executor.py tests/test_interview_media.py
```

For offline real-process recovery checks, use `script/interview_recovery_check.sh` and
the isolated [recovery guide](../interview-demo.md). For real browser QA, use the
[real QA guide](../interview-real-qa.md). Do not enable paid execution in an offline
test database or create another ledger to renew the verification allowance.

## Spoken interview access

The spoken interview surface is available to authenticated users. `startInterviewDemo` creates
fictional context in real mode (legacy explicit fake requests are rejected);
`interviewSession(id)` and `interviewSessionUpdated(id)` read through the
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

The React entrypoint is `/interviews` (and `/interviews/:id` for reloads).
The normal Compose stack starts the real runtime with credentials from the ignored
`services/ai/.env` and a shared private service secret from the ignored root `.env`.
Written practice remains at `/interview-prep`.

The browser selects supported WebM/MP4 recording and stops the microphone with **Done answering**.
The active room keeps the original main question visible while showing the latest follow-up
separately. It shows the initial question only once; earlier exchanges and saved response
counts remain in **Saved conversation**. A saving request displays immediate accessible
loading feedback; only an unresolved response after the request finishes offers submission
recovery. Each saved interviewer turn has one play/pause-or-stop/replay control. A completed
turn replays from the beginning; a paused provider recording resumes from its current position. Turn headings distinguish recording, local review,
submission, answer processing and speech recovery without exposing execution checkpoint names.
Provider and retention details remain accessible in **Interview details and privacy**; preparation
still discloses providers before starting. Terminal session updates release local microphone
capture, including abandonment from another tab.
The user can then listen, discard, or re-record; only the separate **Submit** action sends it. Permission, format, disconnect, size and time-limit
errors discard or preserve bytes as appropriate without submitting. A pre-submission upload failure
keeps the recording for an explicit retry. Once a durable submission identity is saved, the browser
may release its bytes even if the response is lost. Only that minimal question/recording/revision/key
identity is kept in local storage, scoped by owner and interview; a successful owned read reconciles
it before an explicit same-key resend. No mutation is automatically replayed after an auth error.
Queries on mount and fresh subscription snapshots on reconnect restore canonical progress without
polling. The session Apollo provider preserves the same ActionCable consumer through
React StrictMode's immediate cleanup/setup rehearsal. Permanent disposal stops the
reconnect monitor, so it runs only after an actual unmount or session replacement;
otherwise a development server reload could close the socket without automatic
resubscription. Reconnect executes the subscription again and receives the fresh
owned snapshot. New current interviewer text attempts browser speech once during an open interview.
In provider mode, newly accepted speech instead obtains a playback grant and attempts playback. The first loaded snapshot is a silent baseline, so
opening or reloading a saved interview does not replay old speech. Repeated and stale receipts
cannot trigger another automatic attempt. Blocked autoplay offers explicit **Play interviewer
audio**; replay and stop (pause for saved provider audio) remain available, with a mute choice scoped to the open session.
Historical speech plays only on request and pauses any other interviewer audio. Microphone
capture disables playback, and playing speech blocks a new recording until paused. Message
changes, abandonment and navigation stop playback and ignore late grant/play completions.
Saved question text is sufficient to record and submit an answer: pending, failed or expired
speech does not disable answering. Speech accepted during microphone capture does not autoplay
over that recording. Missing question text, active answer processing and ambiguous submissions
still prevent conflicting new answers.
Provider playback obtains a fresh grant for the same saved message; it never retries reasoning or
speech generation. Expired grants can be renewed while the artifact itself remains retained.

For browser-reachable local storage, Compose defaults `INTERVIEW_BROWSER_STORAGE_ORIGIN` to
`http://localhost:9090`; override it when QA uses a different published storage port. The direct
PUT uses exactly the signed headers and never sends account cookies. The isolated stack checks
real S3Mock PUT/GET/HEAD preflight responses. Actual browser upload, microphone and playback
behavior still need human QA; frontend automated checks use browser resource fakes.

The [isolated recovery guide](../interview-demo.md) provides deterministic restart checks
without provider credentials. The [real QA guide](../interview-real-qa.md) uses the same
loopback browser URL against the original paid database. The old fake QA containers are
stopped with data retained; no UI control creates or continues scripted interviews.

### Real audio adapters and verification spending

The real audio HTTP adapters are wired into the real executor. They do no interviewer
reasoning. `AudioProviders.transcribe`
validates the actual container/duration before one multipart gpt-transcribe request.
`AudioProviders.speak` sends its supplied saved text unchanged with gpt-4o-mini-tts and
marin, collects bounded WAV audio, and validates it before returning playable bytes.
Pydantic AI remains the only dialogue-agent boundary. Audio HTTP has no SDK or hidden
provider retries. A response has finite byte/time bounds, redirects are refused, and each
actual dispatch is fenced by the execution's remaining deadline.

`ProviderCalls` preregisters each dispatch with Rails and assigns a new observation UUID,
including future screening and model retries. Admission failure or an ambiguous admission
receipt causes no provider request. The internal receipt registers the shared unfinished
usage marker before any potentially charged I/O. See
[the audio/provider accounting contract](interview-provider-accounting.md) for documented
rate units, conservative reservations, unknown-cost recovery, and the paid-check target.


### Explicit real runtime admission

`interviews.real_app` is a separate development-only process, enabled by `INTERVIEW_REAL_RUNTIME_ENABLED=true` and an explicit `INTERVIEW_ENVIRONMENT=development`. It constructs fixed approved audio/model clients only after service/storage origins and required provider credentials pass validation. Client shutdown closes both provider SDK transports and the audio transport. The fake entrypoint retains its environment isolation and disables paid model requests.

New real sessions additionally require Rails `INTERVIEW_REAL_ADMISSION_ENABLED=true` and a successful bounded readiness probe of the dedicated real process. The probe sends only the service credential to its validated configured origin, ignores proxy environment settings, rejects redirects, caps response bytes and has an overall two-second deadline. Browser errors are stable setup instructions, never raw endpoint bodies or credentials. Disabling this admission switch leaves old sessions' immutable modes and configurations, reads, recovery and cleanup intact. Stopping the real runtime is the separate action that stops execution of already saved real work.

Real speech follows the shared media/registration path but synthesizes exactly the accepted message text; it never runs transcription or reasoning. A failed delivery preserves text and history. Its bounded explicit retry operates only on that saved speech identity. Real reasoning spans use repository contact/privacy processors and operation IDs, without recording audio, storage grants or service credentials. See [real browser QA](../interview-real-qa.md) for startup and [offline recovery](../interview-demo.md) for deterministic integration commands.

## Earlier accepted dialogue

Turn claims add optional `earlier_dialogue` version 1 alongside the mutually exclusive
prepared `interview_context` or legacy `fixture_context`. Older claims without it remain
valid. Rails selects only persisted public opening/answer/follow-up messages belonging to
questions before the current position, requiring an accepted answer. Rejected/provisional
transcripts and private per-question model/tool history are never selection sources.

Selection scans question positions newest first, using a 12,000 Unicode-character budget
summed over complete message content (including openings and follow-ups). A group that does
not fit is omitted whole; selection continues to older groups that might fit. Exact fits
are retained. Selected groups and their messages return in chronological order; sorted
`omitted_question_positions` records every eligible group excluded by the budget. No
summaries, partial messages, or truncation of personal facts are produced.

Python validates the version, budget, unique ordered positions, disjoint omission positions,
and complete opening/answer/follow-up sequencing, then checks the aggregate content cap.
Every execution freshly screens the masked source containing this public dialogue together
with required frozen context, question and current transcript. The existing 120,000-character
prompt/history guard counts that complete source plus current-question model history before
interviewer dispatch and on subsequent model requests. Oversized required inputs fail with
`context_limit`; screening rejection/unavailability retains its explicit failure code.
Current-question typed version-1 private history preserves accepted transcripts, model output
and paired tools. Exact copies of the current masked context envelope are replaced by their
transcript alone, both when restoring older histories and saving new ones. Each execution
supplies and screens the complete current context once; unfamiliar or changed historical
inputs remain intact for screening and size checks. This avoids multiplying a large library
and earlier dialogue across all three responses without discarding conversational history.
Instructions treat prior answers as candidate claims, frozen library evidence as sourced
facts, and fictional role requirements as imagined requirements, never personal achievements.

Offline verification uses canonical Rails claims and the Python executor with fake providers;
no paid summarization, provider calls, or quality judges are required for this contract.

## Deterministic full-session process evidence

`script/interview_full_session_check.sh` runs the current preparation/review/begin and all
nine questions through real Rails/Postgres/private storage and the real Python executor,
with synthetic HTTP responses at each provider SDK boundary. Its isolated internal-network
project has no provider credentials or public fake path. It checks killed processes,
acceptance replay/lost receipts, speech-only recovery, abandonment fencing and persistent
playback. See [offline checks](../interview-demo.md) for the exact command and scope.
Legacy `script/interview_recovery_check.sh` remains coverage for retained fixture sessions.
Neither deterministic harness establishes live quality or browser microphone behavior.

## Private latency evidence

The existing Logfire operation/model traces are supplemented by content-free,
monotonic stage events for discovery/claim requests, recording download,
transcription, screening, reasoning, speech storage and durable acceptance.
They do not expand public snapshots or replace Rails timestamps/accounting.
See [latency measurements](../interview-latency.md) for exact stage coverage,
clock-domain limits and the isolated offline scheduler probe.

Normal local execution completion now hints the supervisor to rediscover durable
work immediately, allowing newly created speech to avoid the remaining idle poll.
Hints coalesce and survive in-flight discovery reads; the existing two-second poll
remains the recovery fallback. Per-visible-operation cooldown and full discovery
failure backoff prevent stale/no-op completions or outages from creating busy
claim loops. Claims, concurrency, leases and accounting remain Rails-owned.

### Browser speech default

Real interviews read saved interviewer text with browser speech synthesis by default.
Begin and turn acceptance save the same dialogue but do not reserve provider speech.
The owned GraphQL snapshot exposes `speechPlaybackMode`, keeping playback and server
scheduling in agreement. Browser voices depend on the browser and operating system and
may use network services. Unsupported or failed speech leaves text and recording usable.
Playback stops on mute, capture, message changes and navigation; bounded start/playback
timers release recording even when the browser emits no completion event. New saved
replies may autoplay; hydrated history requires an explicit Play action.

Set `INTERVIEW_SPEECH_PLAYBACK=provider` on the API to enable the retained OpenAI
speech path, including its saved audio, accounting and retries. No frontend setting is
needed. Scripted service fixtures keep provider playback. Existing saved provider audio
and accounting are preserved in browser mode; old real speech reservations are excluded
from discovery and new claims. Work already executing can finish normally. Preparation,
transcription, screening and interview reply generation are unchanged.

Browser delivery prefers Google UK English Female, then another British English
(`en-GB` or `en_GB`) voice, before named English voices, the browser's default English
voice, or another English voice. An empty voice list gets up to 300 ms to
load through `voiceschanged`; otherwise playback requests `en-US` with the engine's
fallback. One selected voice is held through the reply, with rate 1.02 and pitch 0.95.
Saved text is spoken in sentence/clause chunks of at most 180 Unicode characters.
The recording interlock remains held across the entire sequence. Stop, mute, capture,
navigation, errors or stalled chunks cancel the sequence; stale callbacks cannot
restart it. Actual voice quality depends on the available browser/OS voices and needs
human listening checks.

## Conversational screening and readable system context

Real spoken interviews use a separate conversational screening interface. Each turn checks
only the newest candidate transcript. Accepted prior utterances come from the authenticated
Rails claim's `current_dialogue` and bounded earlier public question groups; old answers,
private tool returns, and framework completion acknowledgements are not re-sent to Jev.
Private saved model history is validated for wire integrity but is rebuilt from those public
records before the next model run. A legacy claim with nonempty private history but no
canonical public dialogue fails closed rather than trusting an arbitrary history payload.
This does not change the generic prompt guard or screening for queued features.

Frozen sources retain field-level `screened` metadata outside model prose. Approved sources
incur no library classifier calls. Unchecked source text is screened together; its source
indices are reported through the fenced Rails callback before dependent generation. Failed
screening or a missing persistence receipt cannot grant usable approval. Preparation also
screens an optional career focus only when its exact fingerprint lacks a matching
`screened_career_focus_sha256` in the frozen context. A newly checked focus requires its
matching callback receipt even when every library source was already approved; missing
receipts prevent preparation. The approval survives later generation failure and claim
retries, remains outside model prose, and is purged with frozen context at cleanup.
Later turns reuse the prepared immutable context. Deploy the expanded Rails callback
before the AI worker: a new worker fails closed if an older server omits the focus receipt;
older workers continue source-only callbacks safely.

The model sees readable career entries grouped by source record, with field/source labels
and escaped data delimiters, plus a separately labeled fictional role. Known contacts are
masked before escaping. A single canonical system message holds this context in each model
conversation. New answer messages contain only the newest answer, not a fresh library JSON
envelope. Reloads and legacy histories rebuild the same public conversation without adding
copies of the library. Each new question has its own private model conversation and starts
with that canonical context. This is one logical system context, not provider-side session
storage: the stateless provider transport still replays the conversation on each request.


### Reviewed typed answers

The answer editor keeps authored text only in tab memory and warns before leaving with a
draft. Explicit Submit sends exactly the reviewed characters as `candidate_transcript` with
`transcription_mode: typed`; `recording_id` is optional for this source only. Rails validates
nonblank text up to 4,000 characters and binds the canonical text digest to the stable
submission key. A supplied digest must match the actual text; changing text under the same
key conflicts. Acceptance rejects text different from the submitted reviewed answer.

Reload recovery stores only owner/session/question/revision/key/source and the digest, never
the text. A lost receipt preserves its exact text in memory for an explicit same-key retry,
after an owned canonical read. If a reload loses that text and the server confirms no saved
operation, release the unresolved identity and ask the candidate to type the answer again;
never substitute audio or silently replay an empty answer. Saved accepted/pending work is
reconciled by its original key. Existing audio-mode recovery remains supported while capture
modes migrate to the reviewed editor.

## Question clarification

Rails coordinates clarification and career-reference tasks in `Interviews::CurrentPromptWork`.
Its `Clarification` and `References` adapters share locking, admission, retries and publication
recovery while keeping payloads, allowances and result validation feature-specific.

`requestInterviewClarification` authorizes an owned active real-mode session and its exact latest
saved opening/follow-up message. It creates one `InterviewClarification` per message.
Only `message.content` enters its SQS payload, alongside the clarification identity;
acknowledgements, spoken text, answers, library and model history are excluded.
Prepared sessions reuse their immutable preparation hourly admission. Clarification
spend and concurrency use the spoken-interview allowance, independently of general AI.

Before screening or generation, the queue worker calls the authenticated
`/internal/interviews/clarifications/:ai_task_id/claim` endpoint. Rails rechecks prompt,
owner, expiry, admission and once-only execution under locks. This adds no AI database
grants. The worker uses `INTERVIEW_RAILS_ORIGIN` and `INTERVIEW_SERVICE_SECRET` (the same
private secret as Rails/the interview runtime); configure these in the queue worker's
environment before enabling clarification. A blank secret fails without provider calls.
Deploy the migration/API and compatible queue worker together; schema fields require
regenerating the web client. Existing saved sessions and interview-runtime operations
keep their contracts.

Clarification rejects an already-claimed delivery before rechecking availability, so a
fresh request finalizes expired claimed work. References check availability first, allowing
redelivery itself to finalize obsolete work before the duplicate-claim guard.

One logical record has at most two explicitly requested task attempts. Queue duplicates
cannot claim an attempt twice. Each task has a three-minute deadline; the UI uses a local
timer to offer explicit retry after missing queue/worker/result delivery, without polling.
A new attempt fences the old task. Queue publication ambiguity checks saved state rather
than replacing an already accepted outcome. There is no automatic regeneration of a
successful explanation. Screening plus generation has a 30-second deadline, a 4,000-character
question cap, a 1,000-character explanation cap, and at most two generation model requests including
fallback. The fixed policy asks only for simpler wording, without answers or coaching.

Results use `ai_results`, existing per-attempt usage deduplication and `aiTaskUpdated`.
Only current, claimed, unexpired prompt results can save an explanation. Late usage still
counts once even when the result is obsolete. Session snapshots include clarification
metadata for reconnect/reopen; the draft remains in the independent in-memory editor.
Generic task reads also hide unavailable clarification input/results. Abandonment and
expiry scrub explanation/input/result text while preserving billing records. No clarification
messages, answer attempts, question progression or speech work are created.

The offline clarification eval runner validates synthetic fixtures/evaluator wiring only;
semantic no-coaching quality remains unmeasured until a separately authorized paid eval.

### Skipping a core-question cycle

`skipInterviewQuestion` authorizes through the owner and changes progression under the
same owner/session/question locks as turn acceptance. A core prompt or follow-up skip
ends that core-question cycle immediately; the final skip saves the closing and completes
the session. The question stores the original submission key and expected revision, so
an exact retry returns current saved state without skipping a second cycle. Changed-key
inputs, stale revisions, and pending/running answer or transcription work are rejected.
A skip creates no accepted answer, consumes no answer allowance and preserves earlier
answers. Public snapshots expose `questions.skipped`; this means the remainder was skipped,
even when earlier answers exist. Skips are not answers for answer-quality scoring.

The room confirms loss of unsent text/audio and clears it only after a saved skip response.
After a lost response it retains the original skip identity and blocks answer submission
until an explicit retry reconciles that identity. Saved dialogue retains an unanswered
follow-up; earlier AI context omits that trailing prompt to keep complete accepted groups.

### Shared avoided questions

During an active real interview, “Don't see this again” saves the current opening or
follow-up message's exact question text to the owner's shared avoided-question preferences.
It does not skip, submit an answer, discard recording/text, or change session progress.
The mutation scopes the session to the signed-in user and rechecks the latest answerable
message under owner/session locks. Old prompt identities fail instead of capturing a new
question. Saved state is exposed on the message and duplicate saves are safe to retry.

New preparations snapshot the shared preference list in frozen context. The same list is
used for preparation and later follow-ups, so preferences added after a session starts
apply to future sessions rather than rewriting the prepared conversation. Written practice
and spoken interviews both save to this list. Legacy contexts without it use an empty list.

The AI renders preferences as escaped, masked question data. These exact server-generated
texts are not screened again or treated as career evidence. Trusted instructions ask the
model to avoid the same intent and close rewordings; spoken semantic avoidance is an
instruction, not a deterministic output guarantee. Invalid or oversized preference context
fails before provider dispatch rather than silently dropping choices. Existing per-account
save bounds and preparation context limits still apply.

## Candidate-facing career references

Optional career references help the candidate recall saved experience while answering.
They display exact saved wording rather than a generated answer. They are independent
of interviewer context, speech, answer drafts, question progression and answer allowances.
The interviewer still receives its existing frozen preparation context.

Career references appear automatically for the current opening or follow-up in active
real-mode interviews. No feature enablement environment setting is required.

The migration can reverse before any reference child tasks have been created. Once
reference usage exists, restoring the old child-task constraint can reject those retained
rows; preserve the populated schema and accounting records during application rollback.

`requestInterviewReferences(interviewId, messageId, retryFailed)` authorizes an owned,
active real-mode interview's latest opening/follow-up. Rails saves one
`InterviewCareerReferences` record per prompt, with at most two explicitly requested
queue task attempts. `interview_references` tasks reuse preparation's hourly admission
but retain their own spend accounting. Reference in-flight work has its own per-user pool,
using the same configured operation cap, so queued guidance cannot exhaust slots needed
for answer execution. The critical-operation pool excludes reference tasks; reference
request and claim admission count only reference tasks. Monthly spend and hourly
admission remain shared with the interview.
Reference capacity counts only the latest prompt-linked attempts whose three-minute
deadline is still live. An earlier prompt's expired attempt does not occupy a slot,
even without worker redelivery. Redelivery checks expiry and prompt availability before
the once-only claim guard, failing obsolete work while retaining late usage. This adds
no polling, automatic regeneration or background sweeper. A private authenticated claim rechecks
availability and returns canonical owner, prompt, reference identity and query text.
Duplicate claims do no paid work. SQS results preserve late or duplicate usage while
rejecting stale content after follow-up changes, skip, advancement, abandonment or expiry.

For openings the query is the saved prompt. Follow-ups include the core question and
immediately preceding accepted answer, using complete messages within the 12,004-character
bound; oversized combinations fall back to the current prompt. Drafts, provisional
transcripts and acknowledgement text are excluded. Query embeddings use existing contact
masking and accounted/traced Pydantic AI embedding helpers; there is no dialogue-model call.
The AI worker reads owned library records and the existing hybrid vector/keyword index.

Selection policy `interview-references-v3` keeps at most three distinct source groups,
prefers narrative evidence to bare skills, and rejects distant vector candidates. Its
initial cosine-distance cutoff is 0.35, not calibrated confidence. Keyword matching covers the complete supported saved corpus, including unindexed sources.
At selection time, vector candidates must match the current normalized index text; stale
index wording is not reused to rank newly edited evidence. This is a one-time source
compatibility check rather than ongoing library monitoring. Fact requirement labels can help ranking; only saved fact
responses are displayed as evidence. Written practice Q&A vectors, job-only gap answers,
profile summary and historical spoken answers are not additional indexed sources.

References use the library at retrieval time and are saved for the exact prompt. There
is no continuous freshness check or in-room library editing. Ordinary owner/source checks
at result acceptance reject foreign or invented evidence. Bodies are bounded at 4,000
characters; oversized source bodies are omitted. Per-role grouping prevents a role and
its highlights filling several cards. No-match results remain empty rather than forcing
three suggestions.

The room requests automatically once per saved prompt and restores durable results on
reload. Task/session subscriptions update independent reference state; no polling is added.
Failures permit explicit bounded retry and never disable recording, speech or submission.
Blur defaults on, with an owner-scoped device preference storing only a boolean; individual
reveal state resets per prompt. Concealed bodies are also hidden from assistive reading.
Reference content is not a browser-storage preference or a security-protected secret.

Public reference metadata is current-prompt-only. Expiry and abandonment scrub copied
bodies and task inputs/results while retaining billing records. Completed review does not
show historical references. See the offline evaluation command below and the manual QA
steps in the real interview guide.

### Retrieval evaluation evidence

From `services/ai`, run `python -m evals.run_interview_reference_evals` with its installed
runtime. It prints a JSON report from synthetic fixtures through the production
`select_references` interface. Default execution is offline: supplied vector distances
exercise cutoff/grouping contracts, and real keyword matching exercises fallback. A green
report establishes fixture agreement, not semantic relevance or real embedding calibration.

`--paid` explicitly runs real embeddings against synthetic source text and reports label
agreement and accounted usage; no dialogue model or database is required. It uses the production source-text projection and selection seam, not a Postgres
query/latency benchmark. `--output PATH`
saves the report only when requested. Errors and mismatched labels fail visibly. Evaluation does not change interview behavior. No paid semantic run or human relevance
assessment was performed during the initial implementation.
