# Interview sessions

Interview sessions own spoken interview dialogue and progress, separate from written
InterviewPrep. Basic Interview is the first supported type in the app.
New sessions prepare 5, 8 or 12 typed main questions from the owner's career library,
using either an owned saved job or a fictional role, then begin explicitly after review. Each question allows at most three accepted
answers (two for Warm-up difficulty). Older fixture sessions keep their one/two questions and two-answer cap. Real providers
run in the normal local Compose stack when its credentials are configured.

### Saved-job practice

The job workspace's **Interview** tab (`/jobs/:id/interview`) holds saved-job setup. Setup uses
the owned job the workspace already loaded and retains the existing round and microphone choices.
`startInterview` accepts an optional `jobId`, resolved through `current_user.jobs`;
no job text is accepted from the browser. Career-library evidence remains required,
and comparison/resume generation is not a prerequisite. Starting from the tab does not change
application stage. Library-only starts retain fictional-role preparation.

Rails saves the owned job ID, scalar `preparation_kind` and optional `career_focus`, plus
bounded setup choices. It does not copy the job or library into the session or claim.
Python validates the live operation's owner, attempt, generation, mode, lease and deadline,
then reads the current owned job, career library, avoided-question preferences and recent
main questions in one read-only transaction during preparation. Missing required jobs and empty libraries stop
before provider dispatch. Notes, gap responses and tailored resumes are excluded.

Preparation runs no injection classifiers and records no source approvals. Contact masking,
escaped data sections, aggregate prompt bounds, exact-input integrity and provider accounting
remain. Job expectations are separate from candidate evidence. Saved-job output requires
`role: null`; Rails stores `prepared_role: {}` and rejects invented replacement roles.
Fictional-role practice still generates and saves a validated imagined role.

Preparation also reads up to 20 latest retained prepared main questions, newest question creation
first with stable session/position/identity ties. Saved-job history matches the exact job and
saved-job preparation kind; generic history includes all fictional-role sessions across formats
and career focuses. Both are owner-scoped, exclude the current session and purged content, and
match the execution mode so fixture questions do not enter real practice. Skipped, unanswered
and expired-but-not-yet-purged questions remain useful history. Deleted saved jobs never become
generic history. Cleanup removes expired content, so this is variety guidance over retained
questions rather than permanent history or a guarantee of novelty.

Recent questions enter separate escaped, contact-masked data blocks as variety guidance,
not candidate evidence or strict exclusions; explicitly avoided questions stay strict exclusions.
Count and per-question limits are checked before model dispatch, and the complete readable
context including history must fit the existing aggregate prompt limit. History is loaded only
inside Python's existing preparation transaction, never copied into commands or HTTP claims.

Turns read prepared questions and canonical accepted public dialogue from the database.
They do not reload the original job/library/preferences or private model history. Current
profile contact fields are read only for privacy masking, never as interview evidence.
Editing/deleting original sources after preparation does not change the questions or break
retained ready, active or completed sessions. Pending saved-job preparation with no remaining
job fails safely. Scalar preparation kind survives nullable job deletion; the migration derives
it and career focus from legacy metadata once, removes copied saved-job roles, and clears
legacy source packages without changing questions or dialogue.

Public `jobContext` is the current owned job association and becomes null on deletion. It
is display/navigation data, not turn evidence. Public `preparedRole` remains non-null JSON;
only fictional practice holds generated role content. The ready screen allows entry with
an empty role and absent job. Apollo retains a null association when an older response arrives.
Job deletion detaches retained sessions under the existing owner/job locks without changing
progression revision, dialogue or pending answer identity. Rejected deletion rolls back detachment.

A user may have several unfinished interviews at once; preparing one never requires resolving
another. Cost and load stay bounded by the shared daily spend cap, hourly start and in-flight
operation limits. A failed or uncertain start reply never replays the start mutation, and the
setup keeps the user's round choices so they can try again. The setup also offers another saved
job and manual reload after a failed job read; an unavailable source never falls back to
fictional-role preparation.

Frozen setup also records difficulty (Warm-up, Realistic or Stretch), interviewer
(Maya, Daniel or Priya), and optional allowlisted focus areas. New and older sessions
default to Realistic, Daniel and no focus when those fields are absent. Preparation
and turn claims carry the same saved choices. Focus biases questions within the selected
format; it never replaces the format or supplies career evidence. `prompts/interview_style.py`
turns the choices into concrete behaviors: difficulty sets how hard prepared questions are and
how much detail an answer needs before advancing; Rails also derives the answer cap from it
(Warm-up 2, Realistic and Stretch 3). Maya acknowledges warmly and asks open follow-ups without
coaching or grading; Daniel stays neutral and structured; Priya skips acknowledgements and
presses for numbers, personal actions and evidence. Follow-ups only run after submission, so no
persona interrupts live answers. Personas share the existing British speech voice and accounting.

When a candidate asks the interviewer something, such as a clarifying question about the scenario,
the model answers it first and continues, at every difficulty and persona. Open scenario details
get a stated practice assumption; it never gives the interview answer or claims employer facts.
The Rails answer cap still applies, so a question in the capped answer moves on unanswered.

The spoken start route lists the owner's latest 20 unexpired real sessions in preparing,
ready, active or completed states. Preparing/ready sessions reopen their saved preparation
or role review; active sessions restore accepted dialogue and progress; completed sessions
reopen for review. Scripted fixtures and abandoned/expired sessions do not appear in this list.

Candidate input supports live provider transcription (the default), browser recognition,
and complete-recording transcription. The owner-scoped browser preference is independent
of interviewer speech playback. Typed answers submit reviewed text directly without a recording. They use the explicit
`typed` input mode, preserve the exact text through acceptance, and never
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
features continue to use SQS and `ai_results` without changes. Leases, fencing, retry budgets,
failure handling and recovery are the shared `AiExecutions::OperationLifecycle` (also used by
chat); `Interviews::OperationPolicy` holds the interview differences (expiry, checkpoints,
recording expiry after a final failure).

The integrated feature includes library-informed preparation, persistence, private HTTP claims/recovery,
accounting and validated private media. The AI HTTP app executes the canonical claims;
the owner-scoped GraphQL interface exposes accepted dialogue and safe operation progress.

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

Each durable command addresses one operation. Claim takes `execution_mode` and
checks the persisted session while holding its locks,
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
`StartPreparationService` persists only the authorized preparation command and bounded choices.
Python selects current usable career-library fields and excludes job-derived library-fact
requirements. Source and prompt bounds apply to actual readable content in Python, not to
serialized duplicate metadata. Retries reread current source records; no source snapshot is retained.

A `preparing` session has one `preparation` operation with no question, recording or message.
The existing private command, lease, heartbeat, failure, retry and accounting contracts
apply. The preparation claim contains versioned owner/session IDs and bounded candidate `setup`;
it requires no storage capability. New starts default to eight main questions and accept only
5, 8 or 12. Rails saves this separately from provider execution configuration in `setup_config`;
public snapshots expose the safe setup, so reload and retry preserve the selected length.
The setup also freezes `question_format`: Mixed cycles behavioral/technical/knowledge;
Behavioral uses behavioral questions only; Technical / Role alternates technical and knowledge;
HR Screening uses the explicit screening category for motivation, background, logistics and
culture fit. Both Python and Rails validate the saved count and exact ordered categories.
Missing format in an older length-only setup means Mixed. This question format does not change
the Basic session type or the saved response cap.
Existing sessions with empty saved setup keep their nine-question preparation policy. No
backfill changes their questions, dialogue or progression. Follow-ups are extra; the length's
10/20/30-minute estimates are approximate rather than session deadlines.
The real executor masks and delimits source text without classifiers or approval callbacks, runs an integrity-guarded Pydantic AI preparation agent
through the accounted approved Luna model, and posts `accept_preparation` with claim identity,
`role` and `questions`. Preparation uses the existing interviewer accounting stage, with a
4,096-output-token cap so the complete question plan fits; dialogue remains capped at 1,024.

Rails validates a short fictional role (title, responsibilities and requirements) and exactly
the saved number of distinct main questions, using the chosen format's ordered categories.
The Python preparation agent validates the same saved count and sequence before returning it. Acceptance
atomically saves the entire role and question list, marks the operation accepted and session
`ready`, and creates no opening or speech. Identical receipt replay returns the saved result;
changed output or a stale generation cannot replace it. Failure leaves no partial question
list, and bounded retries reload the current authorized preparation sources. `BeginService` (the owned public `beginInterview` mutation) changes ready to active and saves
the first opening atomically, plus one speech operation only in provider playback mode. Concurrent/repeated begin returns
the saved state without duplicate messages or speech. Begin can also replay after progress
or completion. Expired and not-yet-ready sessions cannot begin; role review alone creates no
speech or recording.

Public snapshots expose the prepared fictional role and safe preparation progress, never
raw personal source snapshots or execution credentials. Question type is persisted separately
from its position. Existing fixture sessions, their two-answer caps and saved configurations
are preserved; the fixture service remains available to deterministic tests.

Seven-day expiry retires preparation and scrubs generated role along with
dialogue/history, retaining the existing accounting markers. Preparation does not create
career-career context entries, saved jobs, coaching or assessment. Automated interview-quality
evaluators remain deferred; offline tests establish contracts rather than generated quality.

### Live conversation mode

In a live interview the candidate and an AI interviewer talk out loud in real time. The browser
and the `ai-live` worker meet in a LiveKit room; `ai-live` talks to OpenAI's realtime model
directly. Unlike turn-based interviews, where Rails accepts each finished turn, nothing waits
for Rails to approve a turn. Instead the agent **records events** to Rails as they happen
over the internal `live_connections` endpoints below, and Rails stays the source of truth. It
saves each prompt, answer, feedback and progress step, refuses stale or ended connections, owns
the time limits and the live allowance, and finishes or recovers the session. Production uses
LiveKit Cloud (`ai-live` connects out; the server opens no media ports); local Compose runs a
dev LiveKit server. Setup and keys:
[production compose](../../infra/compose/README.md#secrets),
[native development](../native-development.md).

| Step | Who calls | Interface |
| --- | --- | --- |
| Join or rejoin a room | Browser | `joinLiveInterview` (returns `LIVEKIT_URL` and a token) |
| Take the dispatched job | `ai-live` | `POST /internal/interviews/live_connections/:id/claim` |
| Record the spoken prompt | `ai-live` | `.../prompt_asked` |
| Record the candidate's answer | `ai-live` | `.../answer_finished` |
| Record spoken quick feedback | `ai-live` | `.../feedback_given` |
| Try the question again | `ai-live` | `.../question_retried` |
| Move on to the next question | `ai-live` | `.../question_advanced` |
| Count time and usage, check limits | `ai-live` | `.../heartbeat` (about every 30 seconds) |
| End the connection | `ai-live` | `.../finish` |
| End from the page | Browser | `endLiveInterview` |
| End quiet connections | Rails job | `Interviews::RecoverLiveConnectionsJob` (every minute) |

All internal calls use the `INTERVIEW_SERVICE_SECRET` bearer like other interview callbacks,
are safe to repeat, and are refused with 409 once the connection or session is over. A malformed
request (a missing or wrongly typed parameter, or an unknown kind or reason) is refused up front
with 422 and `code: "invalid_request"`; the agent treats it as a definite refusal and logs it as
an error, since it would fail the same way every time.

#### Joining a room

Each session saves a readonly `conversation_mode` column: `turn_based` (the default, and every
older session) or `live`, chosen by `startInterview(conversationMode:)` and shown as
`InterviewSession.conversationMode`, both the GraphQL `ConversationModeEnum` (`TURN_BASED` or
`LIVE`, built from `InterviewSession::CONVERSATION_MODES`). Live preparations accept
only 5 or 8 questions; preparation itself is unchanged. `BeginService` refuses live sessions, so
no turn-based opening is saved for them. The other turn-based actions (submitting or skipping a
turn, reserving a recording, starting a recorded transcription, authorizing streaming
transcription, clarification and avoiding a prompt) refuse them too with "This is a live
interview", through one guard (`Interviews::TurnBasedOnly`); career references, session
feedback, `endLiveInterview` and abandoning still work. Instead, the owned `joinLiveInterview` mutation
(`Interviews::JoinLiveService`) accepts a `ready` or `active` live session, moves ready to active
without saving an opening (the live agent saves it when spoken), and creates or reuses the
session's one open `InterviewLiveConnection` (a partial unique index allows one row that is not
`ended`). A new room (no open connection yet) for a saved-job session whose job was deleted is
refused with "The saved job for this interview was deleted…", because the interviewer reads the
job when it starts; an open room can still be rejoined. The room name is `interview-<session id>-<random>`. It returns `LIVEKIT_URL` and a
ten-minute LiveKit token signed with `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`: identity
`user-<id>`, room join for that room only, and a room configuration that dispatches the
`careerdrafter-live-interviewer` agent with metadata holding only `interview_session_id` and
`live_connection_id`. Missing LiveKit settings fail the join with a configuration error. Rails
makes no LiveKit request. Live connections are destroyed with their session.

#### The `ai-live` agent

The `ai-live` Compose service (same `services/ai` image, `python -m livekit.agents start
live_interviews/worker.py`) is a LiveKit Agents 1.9 worker registered for explicit dispatch as
`careerdrafter-live-interviewer` (`live_interviews/settings.py`; it must match
`JoinLiveService::AGENT_NAME`). It serves no HTTP. On SIGTERM it drains: it takes no new jobs
and exits once its running interviews end, after at most 50 minutes (`DRAIN_SECONDS` in
`live_interviews/worker.py`: the 45-minute wall-clock cap plus a margin). LiveKit dispatch is
pull-based, so two workers with the same agent name can run at once and a draining one refuses
every new job. Deploys rely on that: `infra/compose/restart-changed-services.sh` starts the new
`ai-live` first, waits until it has registered, then sends the old one a single SIGTERM and
leaves it to drain in the background. New live interviews always find an interviewer, a running
one is never cut off by a deploy, and the deploy does not wait (see `infra/compose/README.md`).
For each dispatched job it:

1. reads the job metadata (the two IDs only) and calls
   `POST /internal/interviews/live_connections/:id/claim` with the LiveKit room name.
   `ClaimLiveConnectionService`
   requires the same room, an open connection and a live, active, unexpired session; it marks
   the connection `connected` (the first `connected_at` is kept, `last_heartbeat_at` moves) and
   returns the session, connection and user IDs, the bill task's `ai_task_id` (used only to tag
   the trace), `question_total`,
   `current_question_position` and `current_question_retry_count` (so a restarted agent keeps
   the retry limit), plus what a fresh agent needs to take over a running connection:
   `heartbeat_sequence` (the last one applied), the current question's latest saved prompt
   (`current_prompt_message_id`, `current_prompt_kind`), `current_prompt_answered`,
   `current_question_answer_count` and `current_question_feedback_given`. These are IDs, flags
   and counts only, never text. Repeats are safe; anything stale is refused with 409.
2. loads its inputs as `ai_reader` (`database/live_interview_inputs.py`), only while that
   connection is `connected`: saved setup, prepared questions in order, the fictional role or
   current saved job, and contact details used only for masking. It never reads career
   references, the career library or dialogue. If the saved job was deleted while the interview
   runs (an agent taking over), it carries on without the job text: the instructions say the job
   details are no longer available instead of failing the start.
3. builds prose instructions (`live_interviews/instructions.py`, framing in
   `prompts/live_interviewer_instructions.py`; the controller's turn instructions and tool results
   are in `prompts/live_interviewer_turns.py`, and `LIVE_INTERVIEWER_PROMPT_VERSION` labels both
   as one prompt on the session span): practice-interviewer framing that marks coaching
   with "Quick feedback:", the persona/difficulty/focus style, the role or job and the question
   plan, all inside escaped data sections with contact masked. These instructions, including
   the saved job text read here, are deliberately not screened: the live interviewer's only
   actions are moving, restarting or ending the owner's current interview through
   Rails-checked callbacks, and it reads nothing beyond these owner-scoped inputs, so injected
   text can only change what this candidate hears or steer their own current interview. The
   exception ends if an interview agent gains a tool that reads other records or acts outside
   the current interview. Contact masking, owner scoping and
   the input bounds still apply.
4. starts an `AgentSession` on the OpenAI realtime model `gpt-realtime-2.1-mini` with the
   persona's fixed voice (maya `marin`, daniel `cedar`, priya `shimmer`), server VAD and input
   transcription with `gpt-live-transcribe`, with LiveKit recording off (`record=False`). Spoken
   text is never logged; logs name only events, error types and refusal codes. Both model names
   are fixed constants (`live_interviews/settings.py`), not settings: Rails bills only these two
   (`Interviews::LiveConversationBill::MODELS`) and refuses a heartbeat naming another model
   with the code `unknown_usage_model`, which both sides log as an error. Tests on each side
   check the same names.

The agent joins the LiveKit room (`ctx.connect()`) only after steps 1 and 2 succeed (the claim
uses the dispatched room's name from the job), so the browser never sees an interviewer that
cannot start. A refused claim ends the job without joining. If anything fails after a
successful claim (the input read, joining or starting the session), the agent calls `finish`
with `failed` before it shuts down, so Rails completes or abandons the interview instead of
leaving the candidate waiting. Later, LiveKit can close the `AgentSession` on its own: an
unrecoverable realtime model error closes it (livekit-agents `voice/agent_session.py`,
`AgentSession._on_error`) while the room stays open, and later speech calls would raise. The
adapter listens for the session's `close` event (ignoring the close its own leaving causes).
Only that model error (`CloseReason.ERROR`) saves the pending answer, finishes with `failed` and
leaves. Every other close the agent did not cause leaves **without** finishing. The main one is
`CloseReason.JOB_SHUTDOWN`: LiveKit shuts the job down, closing the session, when the agent's own
room connection drops or the room closes (livekit-agents `ipc/job_proc_lazy_main.py`, the room's
`disconnected` handler and `_run_job_task`'s shutdown). The clock and heartbeats stop, reports
already queued for Rails are still delivered within the same bounded wait (the job's shutdown
callback waits for them before closing the Rails client), and nothing new is saved or counted.
The connection stays `connected`, so the candidate can rejoin and a fresh agent take over; if
nobody does, recovery ends it as disconnected after 150 seconds without a heartbeat. Speech
calls on a closed session are skipped, and one failed action never stops the clock or heartbeat
loops (logged by error type, never content).

#### Questions, answers and coaching

The pure `LiveInterviewController` (`live_interviews/controller.py`) takes events and returns
actions. The LiveKit adapter (`live_interviews/agent.py`) turns LiveKit callbacks into events,
holds a tool call until the candidate's ended turns are transcribed, marks preambles, and
carries out the actions. Delivery to Rails is a separate LiveKit-free module,
`live_interviews/reporter.py` (`LiveReporter`: `send(report)`, `flush()`, `heartbeat(...)`,
`finish(...)`): it keeps reports in order, resends lost reports and heartbeats, tracks the
heartbeat usage Rails acknowledged and the seconds not yet carried, and hands Rails' receipts
back as controller events. The adapter runs controller steps one at a time under a lock, but no
step waits for Rails: reports, heartbeats and the finish join one ordered queue that a single
background task delivers through the reporter, and receipts and heartbeat replies come back as
events. So a slow Rails (a call can take about 25 seconds plus one retry) never holds up a tool
result, a room choice, the clock or a transcript. Leaving waits up to 30 seconds
(`DELIVERY_WAIT_SECONDS`) for that queue, so the finish still reaches Rails after everything
reported before it, and End interview's RPC answers once its finish was delivered. An answer
still waiting for its prompt's receipt is reported when the receipt arrives, even after the
finish was decided. Events are the
final transcripts of both sides (`conversation_item_added`), the model's interview tools
(`ask_follow_up`, `finish_answer`, `repeat_question`, `next_question`, `give_feedback`,
`offer_menu`, `give_hint`, `retry_question`, plain `@function_tool` methods on the agent), the
room's `interview.choose` RPC, a clock tick about once a second, Rails' saved-prompt receipts
and the candidate's End interview. Every tool call gets one tool result; LiveKit has the
realtime model speak in reply to it, so the result says what to say next (ask the follow-up,
repeat the prompt, give quick feedback, offer the choices, ask question N, close) or why the
call was refused. A room button has no tool call, so its choice ends with a `generate_reply`
carrying the same words instead (after interrupting the interviewer). With the realtime model the
provider may send the candidate's final transcript after the reply it prompted has started, and
LiveKit runs tools while that reply is generating. So the adapter holds a tool call until every
candidate turn that has ended (`user_state_changed` from `speaking`) has its final transcript, for
at most 3 seconds; the decision (save, follow up, move on) then sees the answer the candidate
gave (livekit-agents `voice/agent_activity.py`, `_on_input_audio_transcription_completed` and
`_realtime_generation_task_impl`). A transcript that arrives later joins the open answer, or is dropped while the next prompt
is being asked, never saved to it. The model may also speak a short preamble ("Sure, let's move
on.") in the same response as a tool call; LiveKit adds that message only after it has played,
after the tool ran, and speaks the reply to the tool's result on the same `SpeechHandle` one step
later. The adapter marks a message recorded on a tool call's speech at the tool call's step as a
preamble (same LiveKit source, `_realtime_generation_task_impl`), and the controller ignores it, so only the reply counts as the follow-up, feedback or
closing the result asked for. The browser shows a button until the agent's next attribute update
arrives, so a click can land after the interview already moved on by voice (the candidate said
"move on" and clicked Move on). Each button therefore echoes the room state counter
`cd.state_seq` the room showed. The controller raises it whenever the question or phase it
publishes changes (never for a clock refresh), so a click from question 1's first menu does not
apply to its menu after Try again, and "How was that?" pressed for the opening's answer does not
land on the follow-up's answer: both pass through `asking` in between. It ignores a choice from an
older room state, or one the current phase does not offer (menu buttons only at `menu`, "How was
that?" only while `answering`), and the adapter decides this
before it interrupts anything: a stale click answers `ignored`, is not carried out a second time
and leaves the interviewer talking. A choice that applies interrupts the speech that is playing
(`AgentSession.current_speech`) and any response whose tool call is still running (LiveKit's
background speeches, `AgentActivity.interrupt`). LiveKit adds a cut-off speech's message only
after the choice has moved the interview on; the adapter drops every message recorded on it, so
cut-off words never count as the feedback, goodbye or next question the choice asked for. LiveKit
also lets a tool call that had already started finish after its response was interrupted
(`voice/generation.py`, `_execute_tools_task`), so a tool call from a response a choice cut off
does nothing and returns a result saying so. On start it publishes room state and asks the model to greet
and ask the current question. Each question then runs like this:

1. The first final interviewer turn after a question or accepted follow-up is reported through
   `POST /internal/interviews/live_connections/:id/prompt_asked` (`question_position`, `kind`,
   `text`). `RecordLivePromptService` saves an `opening` with the **prepared question text**
   (semantic key `question:<id>:opening`, as `BeginService` does), never the spoken words, so a
   cut-off opening cannot shorten the saved question and references match turn-based; a repeat
   returns the saved opening. A `follow_up` saves the spoken text (bounded by
   `TextLimits::PROSE`) under the controller's `prompt_key` (semantic key `live_prompt:<key>`).
   The key is `q<position>-r<retries>-f<answers so far>`, so a retry of the request, or an agent
   that took over after a crash and asks at the same point, returns the saved follow-up rather
   than saving a second one. It is refused
   until the latest prompt of the current question has an answer and once the question has
   `answer_cap` answers. The receipt's `message_id` is fed back to the controller, naming the
   opening or the follow-up's key. The reporter sends reports to Rails in order: one whose answer was lost (a
   transport error, so it may or may not have been saved, or a 503 that two retries after a short
   wait, 0.5 and 2 seconds, did not get past: Rails' 503 after a database wait means "rolled back,
   retry the same request") stays first and is resent unchanged
   before any newer report, and before each heartbeat and the finish. A report or heartbeat still
   answered 503 after five delivery rounds is dropped with an error log; any other 5xx after the
   retries is an unhandled Rails error that would fail every time, so it is logged as an error and
   dropped like a refusal. Neither can hold up the reports and heartbeats behind it. Repeats are safe because
   openings, prompt keys and answer replacement make them idempotent. An answer to a prompt whose
   receipt has not arrived waits and is reported with it. A report Rails refuses outright (409 or 422) is
   stale and dropped; a refused answer is not counted as saved, so the next save reports it again.
   A refused prompt (such as a follow-up asked after Rails refused the answer before it, so the
   latest prompt has no saved answer, or one for a question that is no longer current) leaves its
   answer nothing to be saved to:
   an answer waiting for its receipt is dropped and no longer counted, and later words to it are
   still heard (feedback and the cap see them) but never reported, so the next follow-up is keyed
   from Rails' count of saved answers.
2. The candidate's final transcripts for the current prompt are joined and reported through
   `answer_finished` (`prompt_message_id`, `transcript`) when the interviewer moves on (an
   accepted follow-up, the next question, `finish_answer` or End interview). Rails accepts at most
   4,000 characters (`TextLimits::PROSE`), so the controller reports a longer answer cut at a
   word boundary, keeping its beginning (`ANSWER_LIMIT`; a test on each side pins the number).
   `RecordLiveAnswerService` saves the prompt's answer (semantic key `live_answer:<prompt id>`)
   and increments `accepted_answer_count`; a later report for the same prompt replaces the text
   (only the latest is kept) without counting again. New answers go only to the latest prompt of
   the current question. The controller also refuses `ask_follow_up` before an answer; at the
   cap it goes to quick feedback instead (step 3).
3. When a question with at least one answer is done (`next_question` or `offer_menu`, or no
   follow-up is left at the cap), the controller does not advance. It runs the coaching loop:
   - **Quick feedback.** The tool result asks the interviewer to step out of role with "Quick
     feedback:" and give one strength and one fix in about 20 seconds, and nothing else. The
     next final interviewer turn is that feedback: its spoken words (cut to 1,500 characters, the
     controller's `FEEDBACK_LIMIT`; a test on each side pins it to `InterviewSessionQuestion::LIVE_FEEDBACK_LIMIT`)
     are reported through `feedback_given` (`question_position`, `text`).
     `RecordLiveFeedbackService` saves them on the current question's nullable `live_feedback`
     (check constraint 1–1,500 characters); later feedback replaces it and a repeat of the same
     words changes nothing. Saving what was spoken, rather than a text the model passes to a
     tool, keeps the review true to what the candidate heard.
   - **The menu.** The controller then has the model offer Try again / Hear the question again /
     Get a hint / Move on and publishes `cd.menu_offered` `true`. From the menu it never moves on
     without a choice: by voice the model calls `retry_question`, `repeat_question`, `give_hint`
     or `next_question`; the room buttons send the RPC options `retry`, `repeat`, `hint`, `next`,
     which map to the same controller events. Other tools (follow-ups, `finish_answer`) are
     refused with "wait for their choice".
   - **Hear the question again** repeats (or lightly rephrases) the core question and offers the
     menu again; it does not reopen answering, because Try again does that.
   - **Get a hint** points to an approach (a structure, the kind of example), never a finished
     answer or wording to recite. Hints are also allowed while answering. They save nothing.
   - **Try again** restarts the whole question: the controller drops unsaved words, reports
     `question_retried` (`question_position`, `retry_number`) and asks the question again, whose
     spoken turn is reported as the opening again (Rails returns the saved opening).
     `RetryLiveQuestionService` destroys the question's answers and follow-ups (their career
     references and clarifications go with them; unfinished reference or clarification tasks
     are failed first with `question_retried`), clears `live_feedback`, resets
     `accepted_answer_count` and sets `live_retry_count` (0–2, check constraint). The opening
     and its references stay. The repeat of the latest `retry_number` is a no-op replay, so a
     retried request never clears the new attempt; a third retry or a skipped number is
     refused, and the controller also refuses a third and has the interviewer say so and
     re-offer the other choices.
   - **"How was that?"** (`give_feedback`, or the room's `feedback` option) while answering
     saves the answer so far, gives quick feedback on it (saved the same way) and returns to the
     answer; from the menu it gives feedback again and re-offers the menu.
   - **Clock.** The adapter sends `Tick(now)` (monotonic seconds) about once a second. Once per
     prompt, after about three minutes of answering, the interviewer politely cuts in to ask
     the candidate to wrap up. A menu that waits three minutes without any choice has the
     interviewer say a short goodbye through its own speech handle and then finishes with reason
     `idle` once that goodbye is heard as a turn or has played. Every choice at the menu
     restarts that wait (the 45-minute connection cap below still bounds it). The model is told not to time the candidate itself.
   A question with no answer at all moves on directly, as before.
4. Move on (`next`) from the menu reports `question_advanced` (`question_position`). `AdvanceLiveQuestionService`
   uses `Interviews::QuestionProgression`, shared with `AcceptTurnService` and
   `SkipQuestionService`: the next question becomes current and its opening is saved with the
   prepared text (the agent's later `prompt_asked` returns it). A question with no answer gets
   `skipped_at`. At the last question nothing moves and the interview stays active; a retry of
   the move just made returns the same receipt.
5. After the last question the model closes warmly; once that turn is spoken the agent
   finishes. The closing may never come back as a finished turn (it was spoken only as a
   preamble, or cut off with nothing forwarded), so any closing (this one, the idle goodbye or a
   wrap-up) also finishes 20 seconds after its first clock tick (`CLOSING_WAIT_SECONDS`). The
   agent calls `finish` (`reason`: `completed`, `ended_by_candidate`, `idle`, `time_limit`, `allowance`,
   `disconnected` or `failed`) and leaves. `idle` was added to the connection's end-reason check constraint; it follows the
   same completed/abandoned rule.
   `FinishLiveService` ends the connection (`ended_at`, `end_reason`) and completes the session
   (`completed_at`) when at least one answer is saved, otherwise runs `AbandonService`. No
   closing message is saved. A repeat after the session finished returns the first outcome.

Every write bumps the revision (so the snapshot is published) and is refused with 409 when the
connection is unclaimed or ended, the session is not a live, active, unexpired one, or the
question or prompt is no longer current. Because prompts and answers are normal messages, the
career references panel, the completed review and session feedback work exactly as for
turn-based interviews. Live speech is saved as spoken, without a screen, by design: the
interview agents' only actions are moving, restarting or ending the owner's current interview
through these Rails-checked callbacks (the feedback agent has none), and they read nothing beyond
the dispatched owner-scoped inputs (see `services/ai/screening/AGENTS.md`). Room state reaches the
browser as the agent participant's attributes
`cd.question_position` (zero-based), `cd.question_total`, `cd.phase` (`asking`, `answering`,
`feedback`, `menu`, `closing`, `ended`), `cd.state_seq` (the room state counter a button echoes)
and `cd.menu_offered` (`true` only in `menu`). The claim
response also carries `answer_cap`. The GraphQL question type exposes `liveFeedback` (null for
turn-based questions), and seven-day expiry clears it with the rest of the dialogue.

#### Room contract

These names cross the agent (`live_interviews/agent.py`) and the browser hook
(`useLiveInterviewRoom.ts`) and are matched by literal tests on both sides
(`services/ai/tests/test_live_interview_agent.py`, `useLiveInterviewRoom.test.tsx`). Rails
dispatches the agent by name; `JoinLiveService` and the agent's settings are pinned the same way.

| Name | Direction | Values |
| ---- | --------- | ------ |
| Agent name `careerdrafter-live-interviewer` | Rails token → LiveKit → `ai-live` | `JoinLiveService::AGENT_NAME`, `live_interviews.settings.AGENT_NAME` |
| `cd.question_position` | agent attribute → browser | zero-based integer as a string |
| `cd.question_total` | agent attribute → browser | integer as a string |
| `cd.phase` | agent attribute → browser | `asking`, `answering`, `feedback`, `menu`, `closing`, `ended` |
| `cd.state_seq` | agent attribute → browser | room state counter, integer as a string; goes up whenever the question or phase changes |
| `cd.menu_offered` | agent attribute → browser | `true` / `false` |
| `cd.seconds_left` | agent attribute → browser | counted seconds left, integer as a string |
| `cd.time_warning` | agent attribute → browser | `true` / `false` |
| RPC `interview.choose` | browser → agent | `{"option", "state_seq"}` for a button: `retry`, `repeat`, `hint`, `next` (shown in `menu`) or `feedback` ("How was that?", shown in `answering`), with the `cd.state_seq` (an integer) the room showed. Answers `accepted`, or `ignored` when the room state has changed since. `{"option": "end"}` answers `ended`. Anything else is an RPC error |

#### Ending the interview

The room's End interview button asks for confirmation, then calls the agent's LiveKit RPC method
`interview.choose` with `{"option": "end"}` (the buttons above answer `accepted` or `ignored`;
unknown options are RPC errors). The agent saves
the pending answer, calls `finish` with `ended_by_candidate` and leaves; it answers `ended` only
once Rails accepted the finish. Before answering, the agent may wait up to 30 seconds
(`DELIVERY_WAIT_SECONDS`) for the last answer, heartbeat and finish to reach Rails, so the browser
sets the RPC's `responseTimeout` to 35 seconds (`LIVE_END_AGENT_TIMEOUT_MS`, that wait plus room
for the round trip) and shows "Ending…" meanwhile. LiveKit cancels the agent's RPC handler at the
caller's timeout, so the browser's must stay above the agent's wait. With no agent in the room,
or when the RPC fails with an error (a refusal, or the agent never acknowledged it), the browser
goes on at once; it never finishes through Rails while the agent may still be delivering, which
could abandon an answered interview and drop its last usage. Then it always calls the
owner's `endLiveInterview(interviewId)` mutation, which runs the same `FinishLiveService` (its `for_owner` entry point) on the
session's open (or latest) connection: it finishes the session when the agent is gone or failed,
and otherwise returns the finished snapshot. The page then shows the completed review, or the
usual abandoned state.

#### In the browser

In the web app, an active live session (or a ready one after "Enter interview room") renders
`LiveInterviewRoom`, whose `useLiveInterviewRoom` hook is the only module that imports
`livekit-client`. The hook exposes captions from the `lk.transcription` text streams (both
sides; a segment's interim text is replaced by its later text), the agent's progress attributes
(including `menuOffered`, `secondsLeft` and `timeWarning`), `mute(on)`, `choose(option)` and
`end()`. The room shows hideable captions, "Question N of M", the time left as `m:ss left`, a
mute toggle, End interview and the references panel for the current saved prompt. Once
`timeWarning` is on, the time left turns red and an alert ("About 2 minutes left. Start
wrapping up.") is shown and announced. While the agent offers the menu it shows a labelled group of four buttons
(Try again, Hear the question again, Get a hint, Move on); while the candidate answers it shows
"How was that?". Buttons are disabled while a choice is in flight (up to 8 seconds), and a
choice the agent didn't get shows a short alert. The completed review shows a question's
`liveFeedback` under its latest answer as "Interviewer feedback". If no agent joins within 15 seconds, or joining
fails, the room offers a new turn-based preparation with the same setup. When the agent
participant leaves the room, the hook clears `agentJoined` and its progress and sets `agentLeft`;
the room says "Your interviewer left the room. Waiting for them to come back…" and the same
15-second fallback applies until an agent joins again.

#### Dropped connections, rejoin and recovery

**The candidate drops.** The agent starts its `AgentSession` with
`RoomOptions(close_on_disconnect=False)`, so it stays in the room when the candidate's
participant leaves. LiveKit's RoomIO links the candidate again when the same identity
(`user-<id>`) rejoins (livekit-agents `voice/room_io/room_io.py`: `_on_participant_disconnected`
resets the linked participant without closing the session, and `_on_participant_connected`
links the next matching participant). The adapter turns the room's `participant_disconnected`
and `participant_connected` events (any non-agent participant) into `CandidateLeft` /
`CandidateJoined`. While the candidate is away the controller says nothing new, the session
clock stops counting (so nothing is billed), the nudge and menu idle waits stand still, and
heartbeats carry on so Rails knows the agent is alive. A wrap-up from a heartbeat finishes at once
without a closing. Back within 2 minutes, the interviewer welcomes them back in a sentence and
carries on from the same place: it repeats the current prompt (the answer so far is kept), or
offers the menu choices again. After 2 minutes away the agent saves the pending answer, finishes
with `disconnected` (completed with an answer, abandoned without) and leaves. A fresh agent
that starts in an empty room waits the same way; a candidate whose join arrives while the agent
is still starting is greeted as usual.

**Rejoin.** `joinLiveInterview` reuses the open connection: the same room with a fresh
ten-minute token, and no 5-minute allowance check. In the browser, `useLiveInterviewRoom` reports
`reconnecting` while livekit-client retries on its own (`RoomEvent.Reconnecting` /
`Reconnected`) and `disconnected` once it gives up (`RoomEvent.Disconnected` after connecting).
The room then shows "Reconnecting…", or "You were disconnected" with a **Rejoin interview**
button that joins through Rails again and connects with the new token. If Rails refuses because
the interview finished meanwhile, the hook refetches the interview, so the page shows the review
or the abandoned state.

**A fresh agent.** The token's room configuration dispatches the agent when LiveKit creates the
room. Rails makes no LiveKit API call, so there is no explicit re-dispatch: an agent that is still
in the room carries on; if the agent left and the room closed, a rejoin creates the room again
and the same token configuration dispatches a new agent. A fresh agent claims the same
connection and the controller restores its place from the claim: it continues the heartbeat
sequence, repeats the current question's opening if it was asked (answers go to the saved
prompt; an answered one counts toward the cap and new words replace it), or, when feedback was
given or a follow-up is current, greets and offers the menu (it never heard that follow-up, so
it cannot repeat it). The fresh agent never heard the question's earlier answers, so it gives no
feedback on them: asked for feedback (by voice, the room's "How was that?" or at a question's
end), it says it can't give feedback on that part after the reconnect and offers the menu, and
it never reports `feedback_given`, so saved `live_feedback` stays. Answers it hears itself (new
words that replace the resumed opening's answer, or a retried question) are coached as usual.
A claim on an already `connected` connection sets its `usage_gap`, because
the earlier agent's usage since its last heartbeat is never reported; the bill then closes
unknown even when the new agent's final heartbeat matches (a retried claim whose reply was lost
is treated the same way). The re-dispatch on room re-creation and how long LiveKit keeps an emptied
room are LiveKit server behaviour, not visible in the installed packages; they need checking
against a real LiveKit server.

**Recovery.** `Interviews::RecoverLiveConnectionsJob` runs every minute
([background jobs](background-jobs.md#interview-cutover-and-maintenance)) and calls
`RecoverLiveConnectionsService`. A `connected` connection whose last heartbeat (or claim) is
older than 150 seconds lost its agent and ends as `disconnected`; an `authorized` connection the
agent never claimed within the token's 10 minutes ends as `failed`. Both go through
`FinishLiveService` without `final_sequence`, so the provider bill stays unknown, and the
session is completed or abandoned by the usual rule. The finish re-checks under the user,
interview and connection locks that the connection is still open and still quiet, so a late
heartbeat or claim wins and a repeat run changes nothing. A quiet connection whose session
already finished or expired is only closed. Abandoning a live session and its expiry cleanup close an open
connection the same close-only way (`FinishLiveService.close_open`; bill unknown, end reason
`ended_by_candidate` for abandon and `failed` for expiry), so the agent's next call is refused. If a heartbeat merely failed while the agent kept
running, or the owner ended the room, the agent's later calls are refused with 409 and
`code: "connection_ended"` (any refusal because the connection ended or the session is no longer
a live, active, unexpired session; other refusals, such as a follow-up past the cap, carry no
code). `finish` follows the same rule through the shared `LiveConnectionAccess` check, apart from
recovery's quiet-connection close. A 404 (the connection was destroyed with its interview) means the same. The agent then
cuts off the interviewer and leaves at once, without calling `finish` again.

**Turn-based fallback.** When the candidate takes "Start a turn-based interview with the same
setup", the room first starts the new preparation, then calls
`endLiveInterview(interviewId, liveUnavailable: true)`, which finishes the live room as `failed`
by the same rule, so the abandoned live session never stays active.

#### Time, live minutes and heartbeats

**Session clock.** Each live session has 25 minutes of counted time
(`Interviews::LiveAllowance::SESSION_SECONDS`, shared by all its connections). The claim
response carries `session_seconds_left` (25 minutes minus the session's billed seconds) and
`allowance_seconds_left`; the controller counts down from the former. Time counts between clock
ticks in every phase except `menu`: while the coaching menu waits quietly for a choice nothing is
counted, for the session clock or the allowance. At the menu, time still counts while the
interviewer is busy (speaking or thinking of a reply, such as a hint or a repeated question),
because the model is running then. The counted seconds left reach the room as
`cd.seconds_left` with each phase change and about every 5 seconds. With 2 minutes left the
controller sets `cd.time_warning` `true` and the interviewer says so once. At zero it wraps up:
tools are refused ("time is up"), menu buttons are ignored, and once neither side is speaking
(the adapter reports LiveKit's `agent_state_changed`, where `thinking` and `speaking` count as
busy, and `user_state_changed`) it saves the pending answer, publishes `closing` and asks for a
short closing through its own speech handle. When that closing has played (or was cut off) the
agent finishes with `time_limit`. So the current sentence always finishes first.

**Heartbeat.** About every 30 seconds the agent posts
`POST /internal/interviews/live_connections/:id/heartbeat` with `sequence` (increasing),
`billed_seconds_delta` (counted seconds since the last heartbeat, never menu waits) and `usage`
(priced provider usage deltas, below). `Interviews::RecordLiveHeartbeatService` applies each
sequence once: it adds the billed seconds, moves `heartbeat_sequence` and `last_heartbeat_at`
and adds the usage. Repeating the latest sequence replays the same answer without changes; an
older one and an unclaimed or ended connection are refused with 409, invalid counts with 422
`invalid_request`. The answer
is `{action, allowance_seconds_left, session_seconds_left, reason?}`: `wrap_up` with reason
`allowance` once the user's live allowance (counting this running connection) is used up, or
`time_limit` once the session's 25 minutes are billed or the connection has been open 45 minutes
since it was first claimed (`LiveAllowance::CONNECTION_WALL_CLOCK`, wall-clock time including
free menu waits, so a room cannot stay open indefinitely); `warn` at 2 minutes of allowance or
less; otherwise `continue`. `wrap_up` gives the same clean wrap-up as the clock (finishing with
its reason), and `warn` the same spoken warning, still only once per session. A heartbeat
whose answer was lost may still have been applied, so the agent resends it unchanged (same
sequence and counts) before any newer one and Rails replays it rather than counting it twice;
seconds counted meanwhile wait for the next new heartbeat. A heartbeat Rails refused was not
applied, so its seconds and usage go with the next one. On finishing, the agent
first sends a final heartbeat with the remaining counted seconds and usage and names it in
`finish` (`final_sequence`). If an agent ignores the wall-clock wrap-up, recovery
(`RecoverLiveConnectionsService`, every minute) ends a connected room still open 5 minutes past
the cap (`WALL_CLOCK_MARGIN`) as `time_limit` by the usual completed/abandoned rule, even while it
heartbeats.

**Live allowance.** `Interviews::LiveAllowance.remaining_seconds(user)` is separate from the
hidden daily spend cap: 10 minutes over the whole trial (connections created since the trial
started, `trial_ends_at` minus the trial length), 60 minutes a UTC day on a paid plan
(connections created since UTC midnight, plus any connection still open or ended since
midnight, so a session running across midnight counts fully toward the new day, also after it
ends) and none once the plan has ended. It sums
`billed_seconds` of the user's live connections. `joinLiveInterview` refuses a new room with
fewer than 5 minutes left (error code `LIVE_ALLOWANCE_LOW`; a rejoin of the open room is not
refused), and so does `startInterview` in live mode. The viewer's remaining seconds are
`me.liveInterviewSecondsLeft`; setup shows the minutes left when Live is chosen and disables
Continue and Start with the reason below 5 minutes. The hidden daily spend cap never stops a
claimed live session, and live costs are recorded but left out of the cap total, so a live session
never blocks the user's other AI work: the allowance is live mode's only limit.

**Cost.** Live usage goes through the provider ledger; see
[provider accounting](interview-provider-accounting.md#live-interviews).

#### Tracing

Each job is one Logfire trace: the adapter starts a root `live_interview.session`
span (IDs only: `interview_id` and `live_connection_id`, then `user_id` and `ai_task_id`, the
connection's live conversation bill task, once the claim returns them, plus `prompt_version`) and
runs the session inside it, and
the worker routes LiveKit Agents' own OpenTelemetry spans to the same tracer provider
(`livekit.agents.telemetry.set_tracer_provider(..., allow_pii=False)`). `live_interviews/telemetry.py`
drops content before any exporter: every `lk.pii.*` attribute (transcripts, chat context,
instructions, response text, tool arguments and output, RPC payloads, room name, participant
identity), the GenAI content attributes (`gen_ai.input.messages`, `gen_ai.output.messages`,
`gen_ai.system_instructions`, tool call arguments/results, prompt variables and similar), the
GenAI message events, and exception messages and stack traces. LiveKit's own PII switch does
nothing here because Logfire's tracer provider is a proxy, so this processor is what keeps
content out. Spans from LiveKit's own tracer (scope `livekit*`) are cleaned by an allowlist
instead: they keep only known-safe keys (counts, durations and timings, model and provider names,
tool names, LiveKit and our IDs, states, error types; `LIVEKIT_SAFE_ATTRIBUTES` and
`LIVEKIT_SAFE_PREFIXES`) on the span and its events, so a content key a LiveKit upgrade adds is
dropped by default. Our own spans keep the blocklist behaviour above. The interview ID key avoids
the word `session`, because Logfire's default scrubbing masks values whose key mentions it. At shutdown the root records the session's known provider cost
(`provider_cost_microdollars`, and `operation.cost` in US dollars) and the worker flushes.

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
reply:)` commits the complete outcome under locks. It
checks current claim identity, lease, execution deadline, interview expiry and revision.
An identical accepted payload returns its saved receipt even after its lease expires;
a changed payload conflicts. Object key order does not affect the payload fingerprint.
A stale or failed operation cannot change dialogue.

Acceptance appends the answer and either a follow-up, the saved next opening, or the fixed
final closing. Rails overrides a continue decision at the answer cap and discards transition
filler on advancement. Public dialogue, count, revision and any enabled provider speech work commit together.
Speech refers to exactly the saved response and its question; it cannot generate dialogue.
Transcript/reply text uses the existing prose limit. Private provider conversation is not
stored on questions, and the accept callback carries no history fields.

Preparation, turn, transcription and speech claims carry a versioned reference payload with
`interview_id`, `user_id` and bounded `setup`. Python reads only each operation's required
saved columns after checking its live fences. Speech loads the exact accepted message and
acknowledgement; turns load the saved reviewed transcript/mode, question and public dialogue.
Media keys stay unreadable; Rails still grants scoped signed storage capabilities. Every turn
acceptance returns only new output; provider conversation
logging remains, and canonical public dialogue is the sole saved conversation authority.
Real preparation and spoken turns skip injection classifiers. Exact-input guards, escaped data
sections, contact replacement, aggregate context limits and accounted reasoning remain.

## Lock order and database invariants

All lifecycle services acquire the owner row first, then interview, ordered question rows,
then operation. Acceptance locks the fixture's bounded question set before the operation,
including any next question it may introduce. New messages and speech work come last. Future
accounting and media code must preserve owner → interview → question → operation → linked
usage records → message/recording order. Never perform provider or storage I/O under locks.

Live callbacks (`LiveConnectionAccess.with_locked`), `FinishLiveService`, and the open-room
close in `AbandonService` and expiry cleanup lock owner → interview → live connection, then questions and messages, then prompt-help records (career
references, clarifications) and tasks. `RetryLiveQuestionService` follows that order: it locks
the question, the messages it removes, their reference and clarification records, and only then
each unfinished task, the same record → task order the queued-result consumer uses
(`CurrentPromptWork#with_result_lock`). Every one of these paths takes the owner lock first, so
they are also serialized by it.

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
with a blank line. That saved text is canonical: provider speech, restored public-dialogue
claims and replay all use it. The one exception is browser playback of a running answer turn,
which may speak provisional streamed text before it is saved. That speech can rarely differ
from the saved text (for example after a model retry); the saved text then wins and what was
already said is never repeated (see [Browser speech default](#browser-speech-default)).
Clarification can read content alone without copying candidate details from the acknowledgement. No new dialogue kind is introduced.
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
issue short-lived upload and playback capabilities only after owner and feature-admission checks.

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

`Interviews::CleanupJob` runs through the Rails durable scheduler every minute and calls
`CleanupService` in bounded batches (limit 1–100, default 10). It retires expired/stale
operations, private capture text and expired sessions; there is no global AI cleanup
HTTP endpoint. Deletion marks durable pending state before storage I/O and retries
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
fixture context, prepared role, dialogue, private history, accepted payloads and task input/results, and marks
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
they expose no browser-facing execution interface. `/internal/interviews/operations` is the generic shared route.
Set `INTERVIEW_SERVICE_SECRET` to a separate random credential and send exactly
`Authorization: Bearer <secret>`. An unset credential disables these routes. The generic execution nudge (`/internal/executions`) and
stream callbacks use `AI_EXECUTION_SERVICE_SECRET` when set, else fall back to this same secret. Browser
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
  The payload contains only version 1, owned interview/user IDs and bounded setup choices.
  All saved source text, questions, dialogue, reviewed transcripts and speech text are read
  from Postgres by Python after validating the same operation fences. No `screen_library`
  callback exists. Private model history and media keys have no AI reader grants. Both HTTP runtimes
  require the restricted database credentials; readiness verifies connectivity and essential
  grants without selecting owner data. Recovery-stack role provisioning supports retained volumes.
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
new UUID. Each claim and renewal atomically saves an exact-identity recovery job.
After lease/deadline loss, that job applies the existing failure policy and saves a
successor dispatch at its due retry time. There are three executions per automatic cycle and six total, with
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

Spoken interviews have their own per-user start and in-flight limits: **10 session starts/hour** and
**three concurrent operations**, configured by `INTERVIEW_SESSIONS_PER_HOUR` and
`INTERVIEW_MAX_IN_FLIGHT_OPERATIONS`. Spoken interview hourly starts and in-flight tasks do not consume
general AI allowances, and the reverse. Spend is the exception: general AI and every spoken
interview stage's known cost (except live conversations, limited by the live allowance) count toward one hidden daily spend cap per user, set by plan
(see [AI safety and usage](ai-safety-and-usage.md#usage-limits)). Users never see that cap or their spend.
Written interview question practice remains general AI. No bills or unknown markers are removed.

Only hourly admission groups interview stages: daily spend sums every spoken
stage task except live conversations, and interview concurrency counts every recently queued spoken task. A claim
excludes only its own task from concurrency, never the preparation root or another operation.
Claims, explicit retries and every provider start recheck the plan, daily cap and interview limits. New child
creation and admission rejection commit together, leaving no execution/provider attempt on
denial. The global retained paid-verification allowance and new-unknown stop remain unchanged.
Daily spend attribution is by task creation day (UTC), including
late retry charges. New child tasks use their creation day; sharing an older hourly root
does not move new task bills into that root's day. This change does not rewrite historical
or unrelated task accounting.

The owner lock admits at most one unexpired preparing/ready/active **prepared** session per
user. Resume or abandon it before preparing another; completed, expired and abandoned
sessions do not occupy that slot. A prepared question permits six distinct submitted
recordings, including failures, independently of its accepted-answer cap. Retrying
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
and retains its original media-bounded retry lifetime. This stops automatic retry dispatch from
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

## Shared execution and offline fixtures

The integrated `app:app` and isolated `interviews.fixture_app:app` compose the same
`ExecutionRunner` with an `InterviewExecutionAdapter`. Rails commits each operation
and fallback job atomically, then nudges the authenticated `/internal/executions`
endpoint immediately after commit. Dependent speech, automatic retries and explicit
retries use this same path. HTTP202 is only an in-memory receipt; durable delivery
requires a terminal operation or a matching persisted claim and recovery job.

There is no work-discovery loop or periodic Python cleanup. The runner reserves two
local execution slots, renews admitted leases every ten seconds, and cancels work
on lost fencing/deadlines. A finished-execution heartbeat permits bounded final
accounting to complete. Shutdown cancels supervised work, leaving exact-operation
Rails watchdogs and queued fallback jobs for recovery. Health reports liveness;
readiness checks configured local admission without requesting work from Rails.

### Adopting saved work during rollout

`bin/rails interviews:adopt_delivery` attaches old pending operations without a
`delivery_job_id` to fallback jobs and old running operations without a
`recovery_job_id` to exact-lease watchdogs. It holds the existing owner-first locks,
preserves attempts/configuration/accounting, retires expired rows, and performs no
HTTP nudge. Repeated invocation does not duplicate existing delivery/recovery jobs.
Normal `db:prepare` startup invokes this idempotent step after migrations, covering
native and Compose startup before the HTTP process is available. Deployments that
migrate through another command must run the task before retiring the old runtime.
This explicit adoption step is not a recurring scan for runnable operations.

The fake runtime is retained only in the isolated offline recovery harness; its former
offline fixture stack runs separately from the integrated app. It deliberately
does not load the worker `.env`, use worker startup,
resolve provider model names, or configure tracing. Real Pydantic model requests and
remote OpenTelemetry/Logfire export are disabled in this process. Existing SQS workers
keep their settings and transport. Operational production deployment remains a separate action.

The Rails client uses an exact configured origin, dedicated service authentication,
bounded request/response bodies, no redirects or environment proxies, and finite
request deadlines. Callback retries keep the same serialized identity; ambiguous
claims are not repeated. Storage has its own unauthenticated client and explicit
allowed origins, so Rails credentials never reach capabilities. Full audio decoding
runs off the event loop so lease renewals remain responsive.

Fake transcription is scripted and does not interpret recordings. Fake screening uses
injected classifiers through the shared policy. The interviewer uses the pinned
Pydantic AI FunctionModel, official input guardrail and typed restored history;
an advance decision is intent for Rails to apply. Each fake stage is
registered before execution and reports explicit zero cost. Saved-text speech uses
four fixed synthetic eSpeak WAV fixtures, generated offline at 155 words per minute;
unknown text has no fallback synthesis. Their text mapping lives in
`interviews/fake.py`. These fixtures exercise real upload, sealing and playback.

Run the dependency image and focused offline checks from this checkout:

```bash
docker compose build ai-worker
docker compose run --rm --no-deps ai-worker pytest -m 'not db' tests/test_interview_runtime.py tests/test_interview_client.py tests/test_interview_executor.py tests/test_interview_media.py
```

For offline real-process recovery checks, use `script/interview_recovery_check.sh` and
the isolated [recovery guide](../interview-recovery.md). For real browser QA, use the
[real QA guide](../interview-real-qa.md). Do not enable paid execution in an offline
test database or create another ledger to renew the verification allowance.

## Spoken interview access

The spoken interview surface is available to authenticated users. `startInterview` creates
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

The React entrypoint is `/practice/interviews` (and `/practice/interviews/:id` for reloads); old
`/interviews` links redirect there.
Setup there has two steps. Step 1 asks who the interview is for: a practice role (fictional,
built from the career library; the default) or any saved job that is not rejected. A job
continues to that job's Interview tab; the practice role shows round setup on the same page,
with a "Change role" button back to step 1. "Practice again" (navigation state
`practiceSetup`) starts at round setup. While a session is active and loaded, the page turns
on the workspace's focus mode: navigation is replaced by a slim bar whose "Leave interview
room" link returns to `/practice/interviews`. Only the surrounding chrome changes, so the
interview page and any recording are not remounted. Leaving does not end the session; the
usual unsaved-recording warning still applies.
The normal Compose stack starts the real runtime with credentials from the ignored
`services/ai/.env` and a shared private service secret from the ignored root `.env`.
Written practice lives at `/practice/questions`.

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

Optional hands-free mode is browser-only: it ends a live-transcribed answer after the chosen
silence, then submits the reviewed text after a short auto-send countdown that the candidate
can stop, skip or cancel by speaking. It uses the same typed-answer submission, so no server
contract changes. The microphone stays off while the interviewer speaks. See
[interview transcription](../interview-transcription.md#hands-free-mode).

For browser-reachable local storage, Compose defaults `INTERVIEW_BROWSER_STORAGE_ORIGIN` to
`http://localhost:9090`; override it when QA uses a different published storage port. The direct
PUT uses exactly the signed headers and never sends account cookies. The isolated stack checks
real S3Mock PUT/GET/HEAD preflight responses. Actual browser upload, microphone and playback
behavior still need human QA; frontend automated checks use browser resource fakes.

The [isolated recovery guide](../interview-recovery.md) provides deterministic restart checks
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


### Interview admission

The shared FastAPI app starts with `uvicorn app:app`; execution is not restricted to a development environment. It constructs fixed approved audio/model clients only after service/storage origins and required provider credentials pass validation. Client shutdown closes both provider SDK transports and the audio transport. The fake entrypoint retains its environment isolation and disables paid model requests.

New real sessions additionally require a successful bounded readiness probe of the AI HTTP app. The probe sends only the service credential to its validated configured origin, ignores proxy environment settings, rejects redirects, caps response bytes and has an overall two-second deadline. Browser errors are stable setup instructions, never raw endpoint bodies or credentials. Stopping the AI HTTP process is the separate action that stops execution of already saved real work.

Real speech follows the shared media/registration path but synthesizes exactly the accepted message text; it never runs transcription or reasoning. A failed delivery preserves text and history. Its bounded explicit retry operates only on that saved speech identity. Real reasoning spans use repository contact/privacy processors and operation IDs, without recording audio, storage grants or service credentials. See [real browser QA](../interview-real-qa.md) for startup and [offline recovery](../interview-recovery.md) for deterministic integration commands.

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
Real spoken answer turns do not call injection classifiers. The existing
120,000-character aggregate context bound, transcript limits, known-contact replacement,
and per-dispatch model accounting remain enforced. Preparation also skips classifiers.
Both real and fixture turns rebuild their model conversation from canonical accepted public
dialogue, never private tool messages or copied provider history. The offline fixture keeps
its local guard and zero-cost stages; it returns only the new output with empty legacy history.
Instructions distinguish candidate claims and fictional requirements from verified facts.

Offline verification uses canonical Rails claims and the Python executor with fake providers;
no paid summarization, provider calls, or quality judges are required for this contract.

## Deterministic full-session process evidence

`script/interview_full_session_check.sh` runs the current preparation/review/begin and all
nine questions through real Rails/Postgres/private storage and the real Python executor,
with synthetic HTTP responses at each provider SDK boundary. Its isolated internal-network
project has no provider credentials or public fake path. It checks killed processes,
acceptance replay/lost receipts, speech-only recovery, abandonment fencing and persistent
playback. See [offline checks](../interview-recovery.md) for the exact command and scope.
Legacy `script/interview_recovery_check.sh` remains coverage for retained fixture sessions.
Neither deterministic harness establishes live quality or browser microphone behavior.

## Private latency evidence

The existing Logfire operation/model traces are supplemented by content-free,
monotonic stage events for claim requests, recording download,
transcription, screening, reasoning, speech storage and durable acceptance.
They do not expand public snapshots or replace Rails timestamps/accounting.
The browser separately records content-free speech-end, submit, reply and first-sound stages
as local `performance.measure` entries; they are never sent to the server.
See [latency measurements](../interview-latency.md) for exact stage coverage,
clock-domain limits and the isolated shared HTTP dispatch probe.

Accepted results and dependent speech commit their own durable delivery intent;
completion does not trigger a discovery read. Source/guardrail/provider work and
accepted-result accounting stay on the existing interview interfaces.

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
from new claims and dispatch. Work already executing can finish normally. Preparation,
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

Streamed interviewer speech lets the browser voice start before a turn is saved. While an
answer turn runs in browser playback, the page observes the turn's provisional spoken text
through [AI output streaming](ai-streaming.md) and speaks each finished sentence, holding an
unfinished last one. A finished acknowledgement arrives followed by a blank line, so it is
spoken straight away even when the interviewer moves on and nothing else streams. On a
question's final allowed answer Rails always moves on, so Python reads the answer cap and
count during its read-only turn load and streams only the acknowledgement then; a follow-up
the model writes is never spoken. The recording interlock stays held while it waits for more text. When the saved reply arrives:

- If its spoken text begins with everything streamed, the same playback carries on with the
  saved text. A follow-up finishes without repeats; after an advance, the next question is
  spoken from the saved snapshot after the acknowledgement.
- If it differs (rare) or the turn fails, the streamed voice stops. Once any streamed sentence
  was heard, the saved reply is shown but not spoken again automatically; Play interviewer
  audio still replays it, and a failed turn shows its usual failure and retry.
- A stream that ends early (failed, reset or unavailable) keeps the text it already streamed,
  because the relay can end it just as the turn is accepted; the turn's saved result then
  decides as above. If nothing was streamed, the saved reply plays automatically as usual.

Observing never starts, retries or cancels the turn. The page skips observing in provider
playback; the turn still publishes its text, which then expires unread.
The browser does not observe or speak streamed text on the last question (the turn still
publishes it): an answer there can complete the interview, and the completed
review replaces the room at once, which would cut streamed speech off mid-sentence. A final
turn's closing is hidden once the interview completes, as without streaming.

## Readable context and canonical dialogue

Preparation reads current owned career/job sources once and renders escaped, contact-masked
career entries and role expectations. It does not classify sources or create approval receipts.
Real spoken turns skip classifiers too. They read prepared questions, fictional role where
applicable, and bounded accepted current/earlier public dialogue from the read-only database;
they do not reread the career library as turn evidence. Exact-input guards, context limits,
contact masking and per-provider usage accounting remain. Unchanged accepted answers are
never reconstructed from private framework messages or tool receipts.

Each stateless provider request receives one readable system context plus canonical public
utterances and the newest answer. No full library JSON or previous provider messages cross
the internal execution claim or acceptance boundary. Canonical dialogue remains visible and
editable through its existing lifecycle; expiry and deletion still purge private content.

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

Python's `worker/interview_help.py` coordinates queued clarification, career references and
completed-session coaching. One set of task definitions supplies command validation,
authenticated claim paths, owned-context loading, dispatch and explicit-retry policy.
Denied claims return usage only, before source reads or paid work. The feature modules
receive admitted canonical context and retain their own screening, retrieval, coaching
validation and usage reporting. The generic worker still owns accounting and result
publication; interactive execution keeps its separate transport and lifecycle.

`requestInterviewClarification` authorizes an owned active real-mode session and its exact latest
saved opening/follow-up message. It creates one `InterviewClarification` per message.
Only the clarification/message identities and a question digest enter its saved task command;
acknowledgements, spoken text, answers, library and model history are excluded.
Prepared sessions reuse their immutable preparation hourly admission. Clarification
spend and concurrency use the spoken-interview allowance, independently of general AI.

Before screening or generation, the queue worker calls the authenticated
`/internal/interviews/clarifications/:ai_task_id/claim` endpoint. Rails rechecks prompt,
owner, expiry, admission and once-only execution under locks. The response contains only
session/record identities and the claim timestamp. Python verifies those fences through
read-only database access before loading the exact canonical question. Narrow column grants
cover auxiliary identities, deadlines and claims; generated results and private media remain hidden.
The worker uses `INTERVIEW_RAILS_ORIGIN` and `INTERVIEW_SERVICE_SECRET` (the same
private secret as Rails/the interview runtime); configure these in the queue worker's
environment before enabling clarification. A blank secret fails without provider calls.
Deploy the migration/API and compatible queue worker together; schema fields require
regenerating the web client. Existing saved sessions and ai-http operations
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

Preparation reads the current shared preference list when claimed. Later follow-ups use
prepared questions and accepted dialogue, so preferences added afterward apply to future
preparations rather than rewriting the prepared conversation. Written practice and spoken
interviews both save to the shared list; no copied preference list is stored on the session.

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
The interviewer receives prepared questions and accepted dialogue.

Career references appear automatically for the current opening or follow-up in active
real-mode interviews. No feature enablement environment setting is required.

The migration can reverse before any reference child tasks have been created. Once
reference usage exists, restoring the old child-task constraint can reject those retained
rows; preserve the populated schema and accounting records during application rollback.

`requestInterviewReferences(interviewId, messageId, retryFailed, visitId)` authorizes an owned,
active real-mode interview's latest opening/follow-up. Rails saves one
`InterviewCareerReferences` record per prompt. Each reopened active interview route or
full page reload receives a new browser visit UUID. A new visit refreshes completed
or empty references; rerenders, panel changes and tab focus retain the same visit.
Durable prompt/visit receipts deduplicate even delayed replays of earlier visits.
A visit joining live pending work records its receipt and reuses that work. Failed
or expired work still requires explicit retry, with one retry per search cycle.
A later successful search can refresh again without a lifetime attempt cap.
The monotonic `attemptCount` orders snapshots across refreshes; `canRetry` reports
the separate cycle retry allowance. Legacy two-attempt records retain exhausted
retry state during migration. Starting a fresh search clears earlier reference cards,
and a fresh empty result replaces any earlier evidence. Visit receipts cascade on
reference deletion and therefore follow interview retention. The refresh migration is
forward-only because retained generations can exceed the original two-attempt constraint. Requests without a
visit ID retain saved-result reuse for older clients. `interview_references` tasks reuse preparation's hourly admission
but retain their own spend accounting. Reference in-flight work has its own per-user pool,
using the same configured operation cap, so queued guidance cannot exhaust slots needed
for answer execution. The critical-operation pool excludes reference tasks; reference
request and claim admission count only reference tasks. Daily spend and hourly
admission remain shared with the interview.
Reference capacity counts only the latest prompt-linked attempts whose three-minute
deadline is still live. An earlier prompt's expired attempt does not occupy a slot,
even without worker redelivery. Redelivery checks expiry and prompt availability before
the once-only claim guard, failing obsolete work while retaining late usage. This adds
no polling, refresh while remaining on the page, or background sweeper. A private authenticated claim rechecks
availability and returns session/record identities and the once-only claim timestamp.
Python validates that claim through read-only owned database access and builds the bounded query
from canonical messages; task commands retain only identities and source digests.
Duplicate claims do no paid work. SQS results preserve late or duplicate usage while
rejecting stale content after follow-up changes, skip, advancement, abandonment or expiry.

For openings the query is the saved prompt. Follow-ups include the core question and
immediately preceding accepted answer, using complete messages within the 12,004-character
bound; oversized combinations fall back to the current prompt. Drafts, provisional
transcripts and acknowledgement text are excluded. Query embeddings use existing contact
masking and accounted/traced Pydantic AI embedding helpers; there is no dialogue-model call.
The AI worker reads owned library records and the existing hybrid vector/keyword index.

Selection policy `interview-references-v5` keeps at most three distinct source groups
and prefers narrative evidence to role descriptions. It searches experience, highlights,
projects, education, certifications and saved career context, excluding bare Skill records
from both the search and cards. Saved narrative text mentioning a skill remains eligible.
A skills-only library returns no references without a query embedding request. This
exclusion is specific to interview references; the shared library index and interviewer
preparation retain their existing source policies. Every displayed reference must meet
`INTERVIEW_REFERENCE_MIN_SIMILARITY` in the AI worker environment (default 0.65, finite
range 0 through 1, inclusive). The default equals cosine distance at most 0.35; this
is an initial heuristic, not calibrated confidence. Hybrid keyword ranking may order
indexed candidates but cannot bypass the similarity cutoff. Unindexed sources are
ineligible until their embeddings have been synchronized. Restart the AI worker after
changing the environment setting; invalid values fail settings validation.
At selection time, vector candidates must match the current normalized index text; stale
index wording cannot qualify newly edited evidence until its embedding is refreshed. This is a one-time source
compatibility check rather than ongoing library monitoring. Career context requirement labels can help ranking; only saved career context
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

### Saving accepted answers to Career context

Active interview history and completed reviews offer **Save to Career context** beside each
retained accepted answer. The preview pairs it with the preceding opening or follow-up for
that core question. The user can edit the requirement/topic and response, then explicitly
save through ordinary Career context creation. Only the selected answer is copied; drafts,
interviewer messages, unavailable prompts and expired text are excluded. Automatic microphone
capture pauses while the active room's preview is open.

The new context is an independent library entry and survives the interview's seven-day text
expiry. Existing topic uniqueness, field lengths and library-size limits apply; duplicate
topics require renaming and never overwrite another response. Overlong source text remains
visible for editing before save. Saving does not change the interview or refresh saved
references. The context is eligible for subsequent career-library retrieval, including
interview references after normal embedding sync; the configured similarity threshold
still determines reference eligibility. Only its saved response is displayed as career evidence.

### Retrieval evaluation evidence

From `services/ai`, run `python -m evals.run_interview_reference_evals` with its installed
runtime. It prints a JSON report from synthetic fixtures through the production
`select_references` interface. Default execution is offline: supplied vector distances
exercise cutoff/grouping contracts and rejection of keyword-only matches. The report
includes the effective environment-configured minimum similarity for both modes. A green
report establishes fixture agreement, not semantic relevance or real embedding calibration.

`--paid` explicitly runs real embeddings against synthetic source text and reports label
agreement and accounted usage; no dialogue model or database is required. Missing/stale-index
and exact-distance fixtures run only offline because rebuilding current embeddings cannot
reproduce those conditions. Paid reports include skipped case names, reasons and count;
their label-agreement metric covers only the remaining semantic cases. It uses the production source-text projection and selection seam, not a Postgres
query/latency benchmark. `--output PATH`
saves the report only when requested. Errors and mismatched labels fail visibly. Evaluation does not change interview behavior. No paid semantic run or human relevance
assessment was performed during the initial implementation.


## Completed interview coaching

Completed interviews keep their read-only questions and accepted dialogue. Coaching starts
only when the owner chooses **Generate feedback** in the completed review; completion itself
never starts feedback. Older retained completed interviews are eligible too. A session with no
accepted answers explains why feedback is unavailable. No audio is required.

The owner receives a qualitative overall summary and strengths, improvements, and an
illustrative better answer for each answered core question. Follow-up questions and accepted
answers belong to that core question. An unanswered skipped question is excluded, while an
answered question whose remaining follow-ups were skipped remains eligible. Examples must
not invent personal experience; role requirements describe the practice role, not the candidate.

Rails stores one `InterviewSessionFeedback` per session and owns admission, its latest task,
claim deadline and validated saved result. `interview_session_feedback` uses the existing SQS
worker/result path, independent of the active-turn HTTP executor. The queue input contains
only the feedback record identity. The authenticated internal feedback claim returns retained
session/feedback identities and the once-only claim timestamp. Python reads canonical accepted
dialogue and generated fictional-role context through a scoped owned database query; duplicate claims perform no
provider work. The dialogue, turn-based or live, is trusted without a fresh screen
(`trust_interview_dialogue`) because the feedback agent has no tools and reads only this owner's
dialogue (the interview-dialogue exception in `services/ai/screening/AGENTS.md`); contact
masking and the prompt length bound still apply. Preparation-backed sessions reuse their root hourly admission and all feedback
usage belongs to the independent interview allowance.

The result envelope is `interview_session_feedback: {summary, questions}`; each question has
its saved `question_id`, `strengths`, `improvements`, and `example_answer`. Rails validates exact
answered-question coverage and bounded nonblank wording before saving it under owner,
session, feedback and task locks. Results cannot change dialogue or progress. Task subscriptions
and interview snapshots expose progress and retained coaching; execution claims stay private.
Coaching is available only while the original session text remains retained.


Feedback attempts have a five-minute deadline and at most two explicitly requested attempts.
A failed queue publication returns the saved failed record alongside its error, so the review
can immediately offer **Retry feedback**. Provider failures and expired claims also require an
explicit retry; SQS redelivery never authorizes a second provider run. Concurrent requests or
retries reuse the same latest task. A late result from an older attempt cannot replace current
coaching, but its independently deduplicated usage still counts. Saved successful coaching is
reused and cannot be regenerated.

The completed review stops displaying transcript and coaching at the session's retention
deadline, including when an already-open browser resumes after suspended timers. Server
request, claim, result and read paths enforce the same retention independently. Scheduled
cleanup scrubs the domain coaching plus input/result payloads on all feedback attempts, marks
unfinished tasks failed, and preserves billing/outcome records. Session deletion performs the
same feedback scrubbing before dependent records disappear.

Manual QA: finish an interview, open Interview feedback, and confirm that opening alone does
not generate coaching. Choose Generate feedback, reopen the session during generation, and
read saved summary and per-question coaching. Confirm unanswered skipped questions are not
assessed. For a failed attempt, choose Retry feedback and verify progress returns without
changing the transcript. An all-skipped interview explains why coaching is unavailable.

## Coordinated source-storage cutover

Migration `20261031010000` removes `interview_sessions.frozen_context` and question
`model_history`/`history_version`. New models ignore these columns before and after removal.
The migration preserves career focus/preparation kind, prepared questions, canonical messages,
operation fingerprints/accepted receipts and all execution/provider/accounting records.
Rolling this migration while old application processes run is unsupported.

For this release, enter maintenance and stop admissions; drain or stop **all old Rails web,
job and cable processes and all old Python executors before** running the new release's
`db:prepare` or starting it. The Rails server entrypoint may run `db:prepare` automatically,
so stopping old processes must precede even the first new Rails start. Then apply migrations
and restricted-reader grants, start only new Rails/Python processes and reopen admissions.
No deployment or drainage is inferred from local tests. Do not purge queues or replay
terminal tasks: retained legacy queue notifications still resolve owned database commands.
Restoring old application code requires a coordinated schema rollback first; rollback can
recreate empty compatibility columns, but cannot restore deleted private execution copies.
