# Offline interview demo and recovery checks

This isolated stack runs the spoken interview with fictional context, scripted transcripts,
and fixed synthetic speech. It never loads a service `.env`, starts paid providers, or starts
the existing SQS workers. A recording does not influence the scripted transcript. These
checks establish transport and recovery behavior; the human checks microphone and playback.

Use the retained epic checkout below. Relative Compose paths resolve against the first
Compose file in `docs/`, so builds and bind mounts use that checkout. The stable project name
is `cg-interview-06`. The former fake browser QA project is retired; real browser QA uses
the original paid database. Do not run an isolated project against two worktrees simultaneously.
The automation stack publishes no ports. Database and S3 objects survive container recreation
in project-scoped named volumes. The committed service credential is for this isolated local
demo only. No runtime HTTP port is exposed to the host.

Run the recovery checks from the primary checkout:

```bash
bash /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/script/interview_recovery_check.sh
```

The script reports the actual recovery assertions and handles its own runtime interruptions.
The automation and real QA projects have separate volumes. Retained project volumes make
failed offline runs inspectable; the stop command below preserves their data.

Stop the automation stack while retaining its data:

```bash
docker compose -p cg-interview-06 -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml down
```

## Browser QA

The scripted browser QA stack is retired. Use the [real browser QA guide](interview-real-qa.md).
The offline runtime and fixtures below remain only for deterministic recovery tests.

## Acceptance evidence

The harness uses real Rails HTTP, PostgreSQL, S3Mock and fake execution, including decoded WAV
uploads and Pydantic history. Its small probe runs the same executor and HTTP client as FastAPI.
It pauses immediately before or after the acceptance request, is killed with SIGKILL, and is
replaced by the ordinary FastAPI runtime. There are no production fault switches. The first
replacement waits for the actual 30-second lease plus backoff; it does not advance a test clock.
A second check discards a successful real acceptance receipt and reconciles through HTTP status.
Retention checks move only disposable fixture timestamps into the past, then verify real
application rejection, S3 deletion and database scrubbing. They do not wait seven days.

This table covers the approved acceptance rows. Service/frontend tests complement process
checks; they do not establish microphone behavior or production storage permissions.

| Row | Observable contract | Evidence |
| --- | --- | --- |
| 1 | Opening, two answers, cap, closing, saved audio | Recovery harness plus `interview_runtime_smoke.rb`; human hears audio |
| 2 | Early advance and two-question openings exactly once | `accept_turn_service_spec.rb`, `create_fixture_service_spec.rb`; `test_interview_executor.py` early-advance tool/history |
| 3 | Identical/conflicting submission identity and competing submits | Harness real DB submit race; `submit_turn_service_spec.rb`, `concurrency_spec.rb`; frontend ambiguous-submit tests |
| 4 | Competing/expired claims and stale dialogue/audio | Harness real HTTP claim race, killed lease recovery and stale heartbeat; `concurrency_spec.rb`, `media_service_spec.rb` stale completion |
| 5 | Reload/disconnect and lost result receipt | Harness real committed receipt loss/status and identical acceptance replay; frontend hook/page reload/reconnect tests; human reload |
| 6 | Pending discovery, lease recovery and bounded exhaustion | Harness real process kills before/after acceptance, pending speech without wakeup; `claim_operation_service_spec.rb`, `test_interview_runtime.py` deadline/exhaustion; budget rejection is saved as actionable failure |
| 7 | Speech-only retry and artifact replay | Harness explicitly fails/retries saved speech, checks unchanged turn execution/counts and reads saved artifact; `media_service_spec.rb` |
| 8 | Screening, malformed/empty/large/long/context/expired input | Harness blocked/unavailable/oversized scripted transcripts and malformed real stored bytes; `test_interview_media.py`, `test_interview_executor.py`, Rails media/claim specs cover other bounds and expiry |
| 9 | Owner, reference, capability and stale-generation boundaries | Harness unauthenticated internal request and stale heartbeat; `interview_demo_spec.rb`, `interview_media_spec.rb`, media service/storage and Python origin tests. S3Mock cannot prove expired credential enforcement |
| 10 | Usage identity, unknown cost, fake isolation | Harness killed execution retains incomplete marker and zero known spend; `provider_accounting_spec.rb`, `test_interview_executor.py`, `test_interview_runtime.py` outbound-denial tests. No paid-cost/latency claim |
| 11 | Retention, deletion retries and permitted metadata | Harness actual storage recreation, completed-speech expiry, object deletion and dialogue/history scrub with usage retained; `cleanup_service_spec.rb` deletion failure/tombstone races |
| 12 | UI devices, permissions, processing, retry and written regression | Full frontend tests, GraphQL ownership/subscription tests; human QA above remains required |

Rails test paths in this table are under `services/api/spec/services/interviews/` except
request tests under `spec/requests/` and `interview_demo_spec.rb` under `spec/graphql/`.
Python paths are under `services/ai/tests/`. Run the standard Docker checks in
[testing.md](testing.md). These checks do not claim that an emulator enforces production IAM,
that browser QA ran, or that real transcription/interviewer/speech quality was evaluated.

## Verification on 20 October 2026

- The complete unchanged recovery script exited zero: both executor SIGKILL boundaries,
  lease/pending recovery, real HTTP receipt reconciliation, races, screening/media rejection,
  speech-only retry, storage recreation, playback, deletion and content scrub passed.
  Disposable fixture cleanup also passed.
- Full Rails suite: 739 examples, zero failures, two opt-in storage examples pending.
- Full offline AI suite: 796 passed; nine database tests deselected. Real model requests
  and external networking were disabled for this suite.
- Full frontend suite: 244 tests across 49 files passed. Typecheck passed; lint reported
  zero warnings or errors across 249 files.
- Portable API/AI/web builds and clean QA volume startup passed. Primary and Solid Cable
  databases were created. The QA web route and auth bootstrap returned HTTP 200;
  credentialed GraphQL CORS matched the QA origin. S3 PUT/GET/HEAD preflight checks passed.
- Documented QA startup and teardown passed. Browser recording/playback and raw
  authenticated WebSocket delivery remain human checks.

### Real spoken loop

Use the [real browser QA guide](interview-real-qa.md) for paid execution. The public
launcher creates only real sessions; scripted sessions are retired. The original paid
database and cumulative ledger must be used for every paid check and browser session.
The guide replaces the earlier root-profile and fake-browser startup instructions.

The isolated deterministic real-process check makes no paid requests:

```sh
docker compose -p cg-interview-11 -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml up -d db s3
docker compose -p cg-interview-11 -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml run --rm api bundle exec rails db:prepare
docker compose -p cg-interview-11 -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml up -d --no-build --wait api interview-runtime
docker compose -p cg-interview-11 -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml run --rm --no-deps api bundle exec rails runner script/interview_real_smoke.rb
docker compose -p cg-interview-11 -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-real-check.compose.yml stop
```

The check overlay uses existing local image names, synthetic credentials and a dedicated synthetic-check flag only. Its usage rows reflect synthetic positive charges in its isolated database; no provider charges are incurred. Its Python entrypoint replaces provider HTTP transports before real lifespan startup, preserving production provider URLs and accounting. It exercises real Rails/PostgreSQL/private storage, forced closing, exact saved-text speech, a known-cost speech failure, independent speech retry, and private playback. Restart its mock runtime before repeating the single injected speech-failure check. Volumes are retained. The existing QA project is not changed. Microphone permissions, preview playback and navigation remain human browser checks.

## Verification on 21 October 2026

See [the current verification evidence](interview-verification.md) for final offline
checks, the repaired real-provider failure callback and the live-test limitation.
The first paid opening-speech attempt left an unknown charge; paid verification stopped.
The former fake QA database is retained offline. Real browser QA uses the original paid
verification ledger; see the [current QA guide](interview-real-qa.md).
