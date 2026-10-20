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

The first delivery slice implements persistence and lifecycle services only. HTTP claim and
recovery handlers, accounting, media authorization/cleanup, Python execution, and the public
demo are subsequent slices. Nothing in the first slice is a new public API or upload grant.

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
