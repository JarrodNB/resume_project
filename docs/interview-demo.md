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
   Confirm submission only follows that explicit action and the visible transcript is scripted.
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
