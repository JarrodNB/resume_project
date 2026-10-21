# Spoken interview verification — 21 October 2026

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
The preserved `cg-interview-qa` stack serves
[the interview demo](http://127.0.0.2:15176/interviews/demo).
It defaults to fake execution; real admission is disabled. Existing fake sessions and
storage are retained. Follow the exact absolute startup, storage-readiness and teardown
commands in [the demo guide](interview-demo.md#human-qa). Browser microphone, local
preview, playback, navigation warnings and reconnect behavior still require human QA.
No browser automation was used.

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

Use the running fake demo for microphone/preview/recovery QA without provider spending.
Do not enable real admission or run pending real sessions while this charge is unresolved.
The isolated QA database is not the paid ledger; enabling paid mode there would defeat the
single-ledger verification accounting policy. Never reset or copy the paid database to
bypass a reservation.

For a future explicitly approved paid investigation, review aggregate ledger state and all
pending real operations **before** starting execution. `script/interview_paid_check.sh`
requires the absolute original ignored AI environment-file path in
`INTERVIEW_VERIFICATION_AI_ENV` and a deliberate `INTERVIEW_PAID_CHECK_APPROVED=yes`.
It uses the fixed paid project, refuses unknown usage/pending work, and always stops its
runtime on exit. It is currently expected to refuse this retained unresolved ledger.
Never copy secret values into commands, documentation or a new environment file.
The explicit paid overlay is `docs/interview-paid-check.compose.yml`; it is never included
in normal QA startup. Keep real execution off by default and stop after any unknown cost.
