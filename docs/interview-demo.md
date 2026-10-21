# Offline interview demo and recovery checks

This isolated stack runs the spoken interview with fictional context, scripted transcripts,
and fixed synthetic speech. It never loads a service `.env`, starts paid providers, or starts
the existing SQS workers. A recording does not influence the scripted transcript. These
checks establish transport and recovery behavior; the human checks microphone and playback.

Use the retained epic checkout below. Relative Compose paths resolve against the first
Compose file in `docs/`, so builds and bind mounts use that checkout. The stable project name
is `cg-interview-06`; human QA uses the separate `cg-interview-qa` project. Do not run
either project against two worktrees simultaneously.
The automation stack publishes no ports. Database and S3 objects survive container recreation
in project-scoped named volumes. The committed service credential is for this isolated local
demo only. No runtime HTTP port is exposed to the host.

Run the recovery checks from the primary checkout:

```bash
bash /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/script/interview_recovery_check.sh
```

The script reports the actual recovery assertions and handles its own runtime interruptions.
The automation and QA projects have separate volumes. Retained project volumes make failed
runs inspectable; stop or remove them using the commands below.

Stop the automation stack while retaining its data:

```bash
docker compose -p cg-interview-06 -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml down
```

## Human QA

Build and start the QA stack:

```bash
docker compose -p cg-interview-qa -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.qa.compose.yml --profile qa up -d --build --wait db s3 api web
docker compose -p cg-interview-qa -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml run --rm --no-deps storage-setup
docker compose -p cg-interview-qa -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.qa.compose.yml --profile qa up -d --build --wait interview-runtime
```

Open [the local demo](http://127.0.0.2:15176/interviews/demo). Sign up using a disposable
account. If confirmation is required, open [local account mail](http://127.0.0.2:13006/letter_opener)
and follow its confirmation link. The frontend API URL is `http://127.0.0.2:13006`;
Rails CORS and ActionCable allow exactly `http://127.0.0.2:15176`. Browser storage grants
use `http://127.0.0.2:19096`; executor grants use the internal `http://s3:9090` origin.
The one-shot `storage-setup` service verifies actual GET/PUT/HEAD browser preflights for
the QA web origin and recording headers. S3Mock provides permissive global CORS; it does
not implement S3 bucket-CORS configuration, so this is a readiness assertion.
Use `127.0.0.2` consistently, including the browser URL; do not substitute `localhost`.
This separate loopback host keeps the demo session cookie separate from the main local stack,
because cookies share a host across ports. Rails development permits IP hosts, and Vite permits
IP addresses by default. Published ports bind only to this loopback address.

1. Start the demo. Check the fictional-context and scripted-transcript labels.
2. Play the opening; allow microphone access, record an answer, and choose **Done answering**.
   Confirm the microphone stops and a local audio preview appears without uploading. Listen,
   discard, or re-record, then choose **Submit recording**. Only Submit uploads; the visible
   transcript remains scripted. Before submitting, try leaving or reloading and confirm a warning.
3. Reload during processing. Confirm saved messages return and the same submission does not
   append another accepted answer. Reload after completion and renew playback of retained audio.
   Disconnect/reconnect, then leave the page open and confirm live updates arrive without
   refreshing. Raw authenticated WebSocket delivery has not been exercised by this harness.
4. Submit the second answer. Confirm the interview closes at its cap and offers no third answer.
5. Deny microphone access, stop a recording early, and retry an upload after disconnecting.
   Confirm useful errors and no accidental answer submission. Try playback with browser autoplay
   blocked; explicit playback should remain available.
6. Confirm written practice at `/interview-prep` still works. Record observed failures and the
   exact browser/OS; no browser-driven automation substitutes for these checks.

To restart the executor without deleting persisted state:

```bash
docker compose -p cg-interview-qa -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml restart interview-runtime
```

Stop containers while retaining data:

```bash
docker compose -p cg-interview-qa -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.compose.yml -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docs/interview-demo.qa.compose.yml --profile qa down
```

For an intentional reset of this disposable demo only, add `--volumes` to that command.
This deletes the project's accounts, interviews and stored audio. Source recordings expire
on accepted/permanently failed turns or after one hour; generated speech survives active
sessions and at most one hour after completion. Text is scrubbed after seven days. Runtime
cleanup removes expired objects in bounded batches. Keep the runtime running for cleanup.

S3Mock does not enforce signed-URL permissions or expiry. Passing these checks proves Rails
owner checks and local byte handling, not production storage security. Production ingress,
provider quality, paid cost behavior and production rollout remain outside this demo.

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

### Real spoken loop (explicit development opt-in)

Fake sessions retain their saved mode and never use real providers. The new-session selector defaults to the offline demo; choosing real is authorized again by Rails. Real sessions send submitted audio to OpenAI for transcription, screened text to TypeSafe and OpenAI, and accepted saved interviewer text to OpenAI speech with an AI-generated marin voice. Done answering keeps the recording in browser memory for listening, discarding or re-recording; only Submit uploads it. Speech retry uses the same accepted message and does not repeat transcription or reasoning.

The root Compose `interview-real` profile is separate from `interview-demo`. Configure `INTERVIEW_SERVICE_SECRET`, `INTERVIEW_REAL_RUNTIME_ENABLED`, `INTERVIEW_REAL_ADMISSION_ENABLED`, `INTERVIEW_OPENAI_API_KEY`, and `INTERVIEW_TYPESAFE_API_KEY` through ignored environment settings. Optional trace export uses `INTERVIEW_LOGFIRE_TOKEN`; no secret values belong in documentation. Rails checks the dedicated process `/ready` endpoint before new real creation; `/health` only means the process is alive. Stable readiness reasons identify disabled runtime, nondevelopment setup, missing service credential, missing provider credentials, invalid service origins, or unavailable Rails. A readiness check never dispatches a paid provider request.

Starting the real profile enables spending on saved real work, including pending opening speech. Do not start it as a routine test. Keep the automated verification target at US$5, reserve conservatively before each request, reconcile actual usage, and stop after any unknown charge; this is not a provider-side hard ceiling. See [provider accounting](architecture/interview-provider-accounting.md). Disable `INTERVIEW_REAL_ADMISSION_ENABLED` to stop new real sessions while preserving old sessions and cleanup. Stop the real runtime to stop executing paid work; saved operations remain recoverable. Never change an old session's mode or substitute models to resume it.

After configuring the named ignored environment settings, these commands explicitly start or stop paid execution in the retained checkout. Starting can dispatch pending real work immediately; do not run this for offline verification. Rails/API must be restarted with its explicit admission setting to enable new real sessions. The existing isolated QA project remains off until the later QA handoff.

```sh
docker compose --project-directory /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docker-compose.yml --profile interview-real up -d interview-real-runtime
docker compose --project-directory /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi -f /home/jarrod/Desktop/resume_project/.worktrees/basic-interview-fastapi/docker-compose.yml --profile interview-real stop interview-real-runtime
```

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
The retained QA URL runs fake execution with real admission disabled. Do not enable paid
execution in that QA database or restart the paid verification runtime while unresolved.
