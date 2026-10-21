# Resume queue restored — 21 October 2026

The user's resume upload reached storage but queue publication failed because this retained
QA stack omitted ElasticMQ and both queue workers. The API had no local SQS endpoint and
AWS rejected its local development credentials. The real QA overlay now includes local SQS,
the Python AI worker and the Rails results consumer. The launcher provisions only the standard
local read-only worker role/grants and keeps an existing interview runtime running.

A temporary local queue received a parse_resume message through the actual Rails enqueue
service. Its synthetic user/task transaction was rolled back and the temporary queue deleted;
no provider request or real user resume was used for this probe. Both workers remained running,
the AI worker reported polling ai_tasks, and the interview runtime still reported ready.
Shell syntax, Compose validation and diff checks passed. After restoration, the live aggregate
showed a recent resume-parsing task completed successfully through the workers. Existing
failed uploads were not silently retried by the coordinator.

Fresh full-code correctness/design reviews through commit 2120006 found no additional runtime
defect. Both identified that preparation tests depended on an ambient screening key. The
coordinator reproduced three failures, then added a synthetic-key fixture without changing
assertions, coverage or production code. The five focused modules passed 60 tests with no
ambient credentials and network disabled; focused Ruff passed. This mechanical test setup
change and documentation were inspected directly; no further behavior review round was needed.

---

# Current runtime status — 21 October 2026

The user explicitly instructed restoring real interview execution and keeping it running.
Both previously recorded unknown-cost observations are now reviewed for admission; neither
is a confirmed OpenAI invoice charge. Actual costs remain unknown and reservations are
preserved. No cost was assigned zero, no ledger was reset, and no additional smoke requests
were sent. The real runtime reports ready and Rails confirms real admission and runtime
readiness. The updated startup command is in [the real QA guide](interview-real-qa.md).
Earlier stopped-runtime descriptions below are historical checkpoints.

---

# Independent interview limits — 21 October 2026

Spoken interviews now have their own per-user allowance: $3/month, 30 session starts/hour,
and three concurrent operations. These are independently configurable with
`INTERVIEW_MONTHLY_BUDGET_USD`, `INTERVIEW_SESSIONS_PER_HOUR`, and
`INTERVIEW_MAX_IN_FLIGHT_OPERATIONS`. General AI usage and general per-user overrides do not
consume or change interview allowances; interview preparation/turn/speech work does not
consume general budgets, hourly starts or concurrency. The public general usage summary
excludes spoken interview bills and incomplete markers. Written interview Q&A stays general.
Every provider bill and unknown marker remains recorded; the separate paid-verification stop
below is unchanged.

The full Rails suite passed **829 examples, zero failures, two existing opt-in storage checks
pending**. Focused service/GraphQL checks passed 164 examples with the same two pending.
The coordinator independently repeated 39 allowance/full-session/usage/GraphQL examples,
all passing. RuboCop inspected 16 files without offenses; Zeitwerk and the full-suite schema
contract passed. Regressions first showed interview costs leaking into general summaries and
both allowance buckets blocking one another, then passed after scoping. Own interview limits,
legacy operations and the full 27-response session remain covered. The legacy recovery runner's
synthetic budget fixture was adapted and linted; that process runner was not rerun.

Fresh blind correctness and design reviewers assessed the full code diff from
`6ad369b7c021ba6c096a2d104bd19e7327a41594` to
`e9c439abfe883c6f599d4add2c14fc263cd30548`, excluding operational/evidence reports, and returned
**no actionable findings**. Their independent network-isolated AI selections passed 59 and
60 tests. No Python/frontend behavior changed in this revision, so earlier full AI/frontend
results below remain their recorded checkpoints. This follow-up record is editorial only.

The API was restarted to load the new configuration. `/library` at
`http://127.0.0.2:15176/library` and API `/up` both returned HTTP 200, and the live API reported
3,000,000 interview microdollars/month, 30 sessions/hour and three concurrent operations.
The real interview runtime remains stopped; no additional paid calls or ledger changes ran.
No database migration or frontend rebuild was needed. The library is active with this code;
new spoken interview execution remains unavailable because of the recorded unknown receipt.

---

# Final candidate checks and bounded live smoke — 21 October 2026

The two independent blind reviews of the full implementation both reproduced a context-growth
bug: an allowed near-limit library plus earlier dialogue was copied into each saved model
prompt, so the third response could fail permanently with `context_limit`. A regression first
failed on response three. The repair retains transcripts and paired model/tool conversation,
removes only exact copies of the current immutable masked context, and supplies/screens that
context once per execution. Regressions cover three responses, older full-envelope histories,
and unfamiliar historical input that must still be screened. The repaired full offline AI suite passed **926 tests**, with nine database tests deselected
and four upstream/configuration warnings; focused Ruff passed. The final review round follows
this repair. Rails/frontend and full process results below describe their recorded checkpoints;
those unchanged surfaces were not rerun after this Python-only repair.

Fresh blind correctness and design reviewers assessed the full code diff from
`6ad369b7c021ba6c096a2d104bd19e7327a41594` to
`722687647d2e7fcbf4a6ee6466cdc1ba2b5fe050`, excluding operational/evidence reports.
Both returned **no actionable findings**. Their independent offline Python selections passed
60 and 59 tests respectively, with network disabled and synthetic keys. They did not execute
Rails/frontend or establish quality/human acceptance. The coordinator inspected operational
docs separately; the final follow-up commit adds only this review record.


The coordinator ran the bounded live smoke on the original `cg-interview-12-paid` ledger,
using offline-generated synthetic laboratory-technician recordings and the approved models.
Preparation produced a coherent laboratory-maintenance role and nine distinct interleaved
questions. No speech existed before Begin. Begin replay produced one opening, its saved WAV
was generated successfully, and the first recording's transcript matched the synthetic source.
The interviewer advanced to the prepared calibration-downtime question. These are observed
samples, not a general quality evaluation; microphone capture and perceived audio quality
remain human QA.

Follow-up speech then failed `dependency_unavailable`, leaving a new unknown observation
`a269e85e-ccd9-4b73-87b9-b98961f8437d` with a US$0.25 reservation. Admission blocked its next
attempt without another provider dispatch; the runtime was stopped. No cause is inferred
from the safe error code. Three-response live progression and final speech were **not**
completed. No unknown was reconciled, assigned zero, or added to reviewed exceptions.

The retained ledger changed from 30 observations / US$0.015414 known / US$0.25 unresolved
to 38 observations / **US$0.018132 known / US$0.50 unresolved**. Known incremental cost was
US$0.002718; actual cost of the two unknown observations remains unknown. The cumulative
US$5 target and original historical exception are unchanged. Paid QA remains stopped.

The temporary operator driver initially mistook an in-flight reservation for unresolved
usage and exited. Preparation finished and reconciled normally; the corrected driver resumed
the same ready session. That setup mistake did not create a second session or allowance.
The later speech failure above is the genuine paid stop condition. All ledger and synthetic
session records were retained. No browser automation, quality judge, model substitution,
merge or deployment occurred.

---

# Current full-session offline verification — 21 October 2026

The current public development flow freezes owned career details and optional focus,
prepares a fictional role and nine interleaved questions, waits for role review, and begins
explicitly. Each question saves at most three responses; this is persistence, not grading.
The public labels now say “responses saved” and “Saved conversation”. Older fixture sessions
retain their two-response cap. Current resume/abandon and session admission behavior is
covered by the full offline suites; the [human QA guide](interview-real-qa.md) describes the
real-only browser path.

Verification commands were run from the retained checkout:

```bash
docker compose -p cg-interview-13 -f docs/interview-demo.compose.yml -f /tmp/interview13.compose.yml run --rm --no-deps api bundle exec rspec
docker run --rm --network none -e OPENAI_API_KEY=synthetic-offline -e TYPESAFE_API_KEY=synthetic-offline -v "$PWD/services/ai:/app" -w /app cg-interview-qa-interview-runtime pytest -m 'not db'
docker compose -p cg-interview-13 -f docs/interview-demo.compose.yml -f /tmp/interview13.compose.yml run --rm --no-deps -e VITE_API_URL=http://localhost:3000 web npm test -- --maxWorkers=1
bash script/interview_full_session_check.sh
```

The Rails suite passed **821 examples, zero failures**, with two existing opt-in private
storage checks pending. The full offline AI suite passed **923 tests**, with nine database
tests deselected and four upstream deprecation warnings. Synthetic keys are setup values;
provider networking is unavailable in the AI unit-test container. Initial AI setup omitted
those keys and was corrected. The demo Compose browser origin also needs the explicit
localhost override above for the existing Apollo socket test.

The full frontend suite passed **272 tests in 51 files** with the localhost override above.
Frontend types/lint, full AI Ruff, focused Ruby driver RuboCop, Rails Zeitwerk autoload,
shell syntax and the UI detector passed. The full Rails run includes the schema-dump
contract; this slice changes no GraphQL schema or generated client. No browser automation,
paid provider calls, quality judges or quality datasets ran in this slice.

A focused mock-provider regression failed with `StopIteration` when the preparation agent
requested its complete role/question tool. The synthetic HTTP runtime now returns a typed
complete plan, and that regression passes. Existing synthetic smoke, failure and conservative
paid drivers now seed usable career details, wait for preparation and explicitly begin.
The paid shell's historical-unknown refusal is unchanged and was not exercised against the
paid database by this worker.

The adapted synthetic HTTP 503 check also passed: preparation completed, Begin created speech,
and Rails persisted `dependency_unavailable`, kept the speech observation's actual cost
unknown and did not accept failed speech. Preparation's known charges remained distinct.
Its synthetic project `cg-interview-18-failure` is stopped with diagnostic volumes retained.

The process harness uses unique `cg-interview-18-synthetic-<run-id>` projects on internal Docker
networks with synthetic credentials, mocked SDK transports and real Rails/Postgres/private S3.
Early interrupted synthetic diagnostic runs are stopped with volumes preserved, including
an intentionally unresolved synthetic reservation. They were not reconciled or deleted.
Fresh synthetic runs are engineering fixtures; they do not renew the retained paid allowance.

The final process project was `cg-interview-18-synthetic-20261021100144-16516`.
It passed preparation after a killed execution (two executions, with the original unknown
execution marker retained), ready/no speech, idempotent Begin, acceptance replay/lost receipt,
speech-only retry with unchanged dialogue/history/counts/turn-provider identities, and an
executor kill after accepted dialogue. It then completed **27 saved responses**, exactly
**9 openings, 18 follow-ups and one closing**, with **55 child tasks sharing one hourly root**.
Stale callbacks and abandoned preparation could not mutate the session; accounting remained.

The initial final storage step exposed a check-driver readiness race after S3 recreation
(connection refused before S3Mock started). The shell now waits for recreation and repeats the actual S3 HTTP preflight; the image
health check alone did not establish readiness of its HTTP port.
The corrected storage step is verified separately on the same completed session; all earlier
full-flow/fault evidence remains from that project. This is a harness setup correction,
not a production storage change. Logs are retained locally as `/tmp/interview18-process-pass.log`
and `/tmp/interview18-storage-ready.log`. All synthetic process services are stopped with
volumes retained; the test database project remains available.

All earlier paid costs, browser observations and smaller fixture-session runs below are
historical evidence. They do not establish the new generated role's quality, nine-question
live progression, microphone capture, real speech quality or current paid ledger state.
Coordinator-owned paid smoke and human QA remain separate release evidence.

---

# Spoken interview verification — 21 October 2026

## Owned resume and abandonment — offline engineering evidence

The existing spoken route now lists the owner's latest 20 unexpired real preparing, ready,
active and completed sessions. Unfinished sessions require confirmation to abandon.
Abandonment fences execution and media immediately, schedules durable object cleanup and
preserves known/unknown accounting and late usage. Existing short URLs expire or disappear
with physical deletion; abandonment does not revoke a capability already returned to a client.

Focused checks: 146 Rails examples, zero failures, two existing opt-in S3 integration checks
pending; 82 offline Python executor/client tests passed; all 49 spoken frontend tests passed.
Frontend types/lint, schema/client generation, Zeitwerk autoload and diff checks passed.
The design detector returned no findings. New tests cover owner/list bounds, idempotent
abandonment, independent-connection acceptance/provider races, stale preparation/audio
callbacks, signing across abandonment, delayed sealing/reaping and retained late charges.
Component/hook tests cover resume links, confirmation/cancellation, and preserving recordings
and pending submission identity until saved abandonment succeeds.

No paid calls, browser automation or live QA changes occurred. Human microphone/navigation,
responsive layout and production storage-capability behavior remain manual checks. Session
allowances and full cross-ticket verification follow separately.

## Library-informed preparation — offline engineering evidence

New public creation now freezes the owner's usable career-library sources and optional
career focus, then schedules durable preparation. A complete fictional role and nine
interleaved questions are accepted atomically into a ready state for role review. No
opening or speech is created by preparation; the explicit begin/full-progression slice
follows separately. Existing fixture sessions and their saved configurations remain intact.

Focused verification on this change: 129 Rails examples, zero failures, two existing opt-in
storage checks pending; 92 offline Python tests; all 40 spoken frontend tests; frontend
types/lint, changed-file RuboCop, Ruff, schema/client generation, Zeitwerk autoload and
diff checks passed. Deterministic design detector reported no findings. Preparation tests
cover frozen/owned evidence, atomic/replayed/stale acceptance, source privacy/contact masking,
blocked and oversized inputs, retry and expiry without deleting accounting.

No provider calls, paid ledger changes, browser automation or quality evaluations occurred
in these checks. Earlier live one-question evidence below remains historical; it does not
establish the generated preparation's quality or a completed nine-question live interview.

## Real browser QA and two-answer completion

The public launcher now creates only real interviews; the mode selector and normal
fake-runtime Compose profile are removed. Legacy fake creation requests are rejected.
The fake QA containers are stopped with volumes retained. Offline test doubles remain.
The [real QA guide](interview-real-qa.md) documents the running browser stack and its
single retained paid ledger, startup preflight and stop command.

A new real session completed opening → first answer → relevant follow-up → second answer
→ fixed closing. Both answers used short, distinct offline-generated Flite recordings.
All three saved speech artifacts were fetched through owner-authorized playback (199,244,
160,844 and 156,044 bytes). The real model chose advancement on the second answer;
the continue-at-cap override remains covered deterministically by Rails service tests.

After the first accepted answer, one test-only storage transport returned HTTP 503 for
the generated speech upload. A test-only callback made that delivery failure terminal
for an explicit retry rather than automatic recovery. The retry succeeded with real TTS
and storage. Exact before/after snapshots verified unchanged dialogue, private history,
answer count, turn execution counts and all turn provider observation identities; only
the speech operation gained its second execution. No fault switch was added to product code.

These full-flow/retry checks added 13 provider calls and 5,718 microdollars (US$0.005718).
The cumulative known cost at completion was 10,669 microdollars, plus the preserved US$0.25
historical unknown estimate. Two abandoned diagnostic sessions were explicitly expired
before ordinary recovery was started, dispatching no old work. Later browser QA calls
continue to use this same ledger and allowance.

Browser automation then signed into a disposable synthetic local account, started a real
session, observed accepted opening speech and enabled recording, loaded its owner-authorized
audio, and played it successfully (`readyState=4`, 4.15-second duration, no media error).
Reload restored the same session. Desktop and 390 px layouts were inspected with no horizontal
page overflow. This added one opening-speech call (1,317 microdollars), bringing known spend
to US$0.011986, with the original unknown US$0.25 estimate unchanged. The runtime is left
healthy for authorized human browser QA; the fake stack remains stopped.

Current focused checks: 37 interview frontend tests; 53 Rails examples covering public
creation, schema, accounting, media/retry and continue-at-cap acceptance; frontend typecheck
and lint, focused RuboCop, Compose validation, shell syntax and UI detector all passed.
Schema and client documents were regenerated together. Microphone capture, permission
prompts and perceived speech quality remain human checks.

## Real speech repair after renewed authorization

The human explicitly authorized short paid diagnostics and a draft fix PR. The retained
`cg-interview-12-paid` database was used throughout, with no ledger reset. The original
unknown observation remains unresolved at its US$0.25 estimate. Only that exact historical
UUID was explicitly reviewed for diagnostic admission; new unknowns still block dispatch.
The earlier stop instructions below describe the state before this authorization.

Short “Hello.” requests established HTTP 200 and terminal token usage. Two independent
wire-format failures were reproduced: a trailing `data: [DONE]` after `speech.audio.done`
was parsed as JSON, and the generated WAV had `0xffffffff` RIFF/data sizes. The latter
made strict FFmpeg decoding fail with a corrupt-packet error despite complete PCM samples.
The parser now accepts the transport marker only after valid usage and rejects subsequent
data. After verified terminal usage, the exact observed 24 kHz mono 16-bit streaming WAV
header is finalized using the received byte lengths. User recording validation is unchanged.
The API parameters/model/voice are unchanged; see the official
[speech endpoint](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

Live verification used manually selected operation claims, with heartbeats, rather than
starting discovery against old pending work. A short real speech returned a validated
43,244-byte WAV. A fresh synthetic session then saved its opening speech, transcribed a
few-second offline Flite recording about a scheduling tool, screened it, accepted the answer
and the follow-up “What changed for the team after you added the shared calendar?”, and
saved the follow-up speech through private storage. No prompt/model changes were needed.
Owner-authorized playback fetched both saved WAV artifacts (259,244 and 160,844 bytes).
The paid project was then stopped with volumes retained; no provider supervisor is running.

Ten new provider calls reconciled to 4,951 microdollars (US$0.004951), including diagnostic
calls and the real loop. Two diagnostic usage reports were reconciled through the original
observation callbacks after inspecting terminal usage; no zero charge was invented. One
historical unknown reservation remains. Total known spend plus its estimate is US$0.254951.
The initial cause of the historical attempt cannot be proven retroactively because its
response was discarded; the new calls establish and repair the two current failures.

Focused checks: 79 offline Python tests passed (audio adapters, real executor, paid runtime,
strict media); 19 Rails accounting examples passed; focused Ruff and RuboCop passed.
The SSE regression failed before the parser repair. Browser microphone/playback QA, full
two-answer live completion, production rollout, and enabling real mode in the fake QA
database remain outside this fix. The retained fake demo is unchanged.

The offline candidate is retained at
`/home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi`.
The browser URL now serves the real stack described above. Earlier evidence below records
the state before that switch. Browser microphone capture, local preview and playback sound
still need the human QA described in [the real guide](interview-real-qa.md).

## Offline evidence

- Final integrated full Rails: 768 examples, zero failures; two existing opt-in storage tests pending.
  Actual private storage and recreation also passed the recovery harness.
- Full frontend: 258 tests in 50 files; typecheck and lint passed with zero warnings/errors.
- Final full offline AI: 895 passed, nine database tests deselected. External networking
  and paid model requests were disabled. Final focused real/fake executor and paid-stop
  checks: 38 passed.
- Full recovery script passed real Rails/Postgres/private-storage checks: competing
  submissions/claims, process kills before/after acceptance, lease recovery, lost receipts,
  replay, stale claim rejection, budget denial, blocked/unavailable/oversized/invalid input,
  speech-only retry, persistent storage recreation, expiry/deletion and content scrubbing.
- A new real-process check returned synthetic HTTP 503 from the actual audio adapter.
  Rails now saves `dependency_unavailable`, keeps unknown cost reserved, and does not
  accept failed speech. Earlier code sent unsupported failure codes and Rails rejected
  the callback, leaving the operation running until lease recovery. Regression tests
  also cover unusable input, invalid provider output and model timeout failures.
- Budget admission regressions passed 34 focused Rails examples: unknown global usage,
  exhausted global budget and an owner allowance changing after claim now save an
  immediate actionable failure, release the task slot and preserve recording/retry eligibility.
  No provider attempt is created on rejection; existing reservations remain unchanged.
- Rails autoload, AI Ruff and check-driver RuboCop passed. Schema/GraphQL contract tests
  are included in the full Rails suite; no schema or generated type changes were needed.

Repeat the full recovery check:

```bash
bash /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/script/interview_recovery_check.sh
```

Its fixed isolated project is `cg-interview-06`; it retains volumes and removes its own
successful disposable fixtures. Stop the whole project after checking:

```bash
docker compose -p cg-interview-06 -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml stop
```

Repeat the extra failure check in a separate synthetic project (no real credentials):

```bash
export INTERVIEW_CHECK_AUDIO_FAILURE=true
docker compose -p cg-interview-12-failure -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml up -d db s3
docker compose -p cg-interview-12-failure -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml run --rm api bundle exec rails db:prepare
docker compose -p cg-interview-12-failure -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml up -d --no-build --wait api interview-runtime
docker compose -p cg-interview-12-failure -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml run --rm --no-deps api bundle exec rails runner script/interview_provider_failure_check.rb
docker compose -p cg-interview-12-failure -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml stop
unset INTERVIEW_CHECK_AUDIO_FAILURE
```

This check deliberately retains one anonymous unknown reservation and its synthetic session.
Repeat it only after inspecting/removing that disposable project's data; do not reset or reuse
the paid verification database for synthetic checks. The successful smoke uses the default
false value and a separate project, as described in the demo guide.

## Live evidence: stopped after the first unknown charge

Historical checkpoint, superseded by the real speech repair and real browser QA evidence
above. It records why the first probe stopped, not the current instruction for operating
QA. The original unknown charge remains unresolved; only its exact reviewed observation
is excepted for admission. Follow [the current real QA guide](interview-real-qa.md) for
startup and spending rules. Any new unknown observation still blocks further dispatch.

Only the opening speech was attempted through real Rails admission, the actual audio adapter
and the fixed `gpt-4o-mini-tts` / `marin` configuration. The one paid verification project is
`cg-interview-12-paid`; its database volume must be retained across every restart.
Before the attempt, its ledger had zero rows, zero known cost and zero unresolved entries.
Afterward it contained one US$0.25 conservative reservation with **unknown actual cost**.
This is not evidence of a US$0.25 charge or a zero charge. Two incomplete usage markers
(provider dispatch and operation) remain; no successful audio/latency sample was obtained.
The upstream status/body was not retained by the safe error adapter, so its cause is unknown.
No provider outage, model retirement or unsupported parameter combination is inferred.

The paid runtime halted discovery on failure and was explicitly stopped. The same
unknown reservation survived a database restart; the guarded paid runner then refused
execution before runtime startup. All paid-project
containers were stopped with volumes retained. There were no further paid requests,
provider retries, model substitutions, operator-zero reconciliation or ledger resets.
The failure-callback repair was verified offline only. It did not clear the original unknown
charge or establish real provider quality. Distinct spoken answers, continuity/relevance,
transcription, silence/noise behavior and final speech remain unverified live. Further paid
work requires human direction and reliable reconciliation; do not restart the paid runtime.

The current official rates were fetched before the attempt: standard short-context Luna
US$0.10 input / US$0.01 cached / US$0.50 output per million tokens
([pricing](https://developers.openai.com/api/docs/pricing?tab=suite));
transcription US$0.0045/minute
([gpt-transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe));
speech US$0.60/million input text tokens and US$12/million output audio tokens
([speech model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)).
[Jev model pricing](https://docs.typesafe.ai/models) was checked as well. The approved model
names were preserved. Official documentation describes TTS retirement on 6 January 2027;
no replacement was selected. The cumulative US$5 allowance is a target with conservative
reservations and actual reconciliation, not a provider-side guaranteed ceiling.

## Bounded manual use

Use [the real browser QA guide](interview-real-qa.md) for authorized manual testing on
`cg-interview-12-paid`. Public scripted sessions are retired. Offline deterministic recovery
checks remain available through [the recovery guide](interview-demo.md).

The original unknown observation remains counted at its reserved estimate and is the only
human-reviewed admission exception. Any new unknown observation stops further paid calls.
Never enable paid processing on the former fake QA database, reset or copy the paid ledger,
or add reviewed observation IDs automatically. The cumulative US$5 target remains unchanged.

Review aggregate ledger state and all pending real operations **before** starting execution.
The separate conservative diagnostic runner, `script/interview_paid_check.sh`,
requires the absolute original ignored AI environment-file path in
`INTERVIEW_VERIFICATION_AI_ENV` and a deliberate `INTERVIEW_PAID_CHECK_APPROVED=yes`.
It uses the fixed paid project, refuses unknown usage/pending work, and always stops its
runtime on exit. It is expected to refuse the retained unresolved ledger; it does not
implement the real-QA launcher's reviewed-observation exception.
Never copy secret values into commands, documentation or a new environment file.
The explicit paid overlay is `docs/interview-paid-check.compose.yml`. The current real-QA
launcher deliberately includes it for the retained paid project; offline recovery does not.
Real execution remains opt-in. A restart resumes eligible saved work and can spend immediately.
