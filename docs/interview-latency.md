# Measuring spoken interview latency

These measurements explain waiting in the existing durable interview flow. They
are private engineering evidence, not user analytics or interview quality scores.
Do not change providers, bypass screening/accounting, or reset the retained paid
ledger to obtain a faster number.

## Available evidence and clock domains

The real runtime already configures Logfire, an `interview.operation` span and
Pydantic AI model instrumentation. Stage durations stay in optional local DEBUG
logs from `interviews.timing`; they are not exported as `interview.stage` events.
Routine Rails operation-discovery HTTP instrumentation is suppressed only during
that polling request. Execution tasks begin outside suppression, preserving model
and operation traces and the runtime's safe failure warnings.

Durations use the Python process's monotonic clock. Never subtract them from
Rails wall-clock timestamps or browser clocks. Local records after claim identify each
fenced attempt separately; aggregate failures and retries separately rather than
mixing them with successful-turn latency. Discovery and claim request durations
have no claim identity because they precede a trusted claim. Their returned IDs
and payloads are not captured.

| Stage | What the duration includes |
| --- | --- |
| `discovery` | One bounded Rails discovery request, not operation queue age |
| `claim` | One Rails claim request, including its HTTP/retry time, not queue age |
| `recording_download` | Recording grant, private download and local audio validation |
| `transcription` | Transcription adapter, including its admission/usage callbacks |
| `screening` | One complete screen invocation, including chunks/fallbacks/accounting |
| `interviewer` | Agent run, including tool/validation retries and any guard-triggered screening |
| `preparation` | Preparation agent run, including guard/validation work |
| `speech_synthesis` | Saved-text synthesis adapter, admission and usage callbacks |
| `speech_storage` | Reserve capability, upload and registration/sealing |
| `acceptance` | Durable result callback plus lost-receipt reconciliation if needed |

Agent timings are inclusive. A screen event inside an agent run is nested work:
do not add it to the parent agent duration. Individual provider dispatch details
remain available through existing model instrumentation and accounting records.
The new events do not change public GraphQL snapshots, claims or schemas.

Rails already owns operation `created_at`/`accepted_at` and fenced execution
attempt `created_at`. For a first successful claim, attempt creation minus
operation creation approximates admission/queue wait on the Rails clock. It is
not pure polling wait: allowance, concurrency and other eligibility gates may
contribute. Later attempts must be reported separately, with prior failures,
retry eligibility and lease expiry; the operation's original creation is not a
fresh retry enqueue time. Never use generic `updated_at` as a completion time.

Still unmeasured by these events: browser upload and local review, browser update
delivery, playback capability acquisition, user playback delay and first audible
speech. Measure browser segments using one browser clock or explicit human
observations, excluding candidate think/review time. They cannot be inferred from
browser automation/tool-call durations or backend acceptance timestamps.

## Repeatable offline scheduler baseline

Run from the checkout under test, using its compatible AI development image:

```bash
docker run --rm --network none \
  -v "$PWD/services/ai:/app" -w /app \
  cg-interview-qa-ai-http:latest \
  python -m scripts.interview_latency_probe --samples 5
```

The probe imports the real recovery scheduler and runs synthetic clients/executors
in one process. It constructs no Rails, storage or model clients and requires no
credentials; `--network none` prevents external access. Five sequential samples
complete the turn at 5%, 25%, 50%, 75% and 95% of a polling cycle. The resulting
speech is then discovered and claimed by the real scheduler. The initial turn
is queued immediately before runtime start; its tiny initial claim delay is not
representative of an arbitrary browser submission between polls.

`--samples` is bounded to 1–20 and `--discovery-seconds` to 0.01–10. Keep the same
sample count, interval and workload when comparing revisions. Output identifies
Python version, interval, raw samples, discovery request count, median and
nearest-rank p95. Five deliberately selected phase offsets are a diagnostic
sample, not a production latency distribution. No CPU/throughput benchmark or
actual provider speed is implied.

Baseline on 21 October 2026, Python 3.13.11, the original two-second scheduler:

| Synthetic turn work | Turn completion → speech claim | Discovery requests |
| --- | --- | --- |
| 100 ms | 1902.600 ms | 2 |
| 500 ms | 1501.568 ms | 2 |
| 1000 ms | 1000.088 ms | 2 |
| 1500 ms | 499.832 ms | 2 |
| 1900 ms | 97.783 ms | 2 |

Median: **1000.088 ms**; nearest-rank p95: **1902.600 ms** (five samples).
This isolates an avoidable completion-to-dependent-speech polling wait. It does
not show that polling dominates the user's real latency, and it does not measure
transcription, screening, reasoning, storage or voice quality. A completion wake-up
can be evaluated against this baseline without reducing the idle polling interval
or replacing durable Rails discovery.

Focused checks:

```bash
docker run --rm --network none -e TYPESAFE_API_KEY=synthetic-offline \
  -v "$PWD/services/ai:/app" -w /app cg-interview-qa-ai-http:latest \
  pytest -q tests/test_interview_timing.py tests/test_interview_latency_probe.py \
  tests/test_interview_executor.py tests/test_interview_runtime.py
```

Real-provider measurements require actual comparable samples and must remain
within existing authorization/accounting controls. No paid calls were needed
for this baseline. Human microphone/playback and perceived-speed QA remain separate.

## Completion-triggered discovery

The runtime now wakes durable discovery after normal local execution completes.
This is a hint, not an operation queue: Rails still discovers eligible IDs,
claims work, fences attempts and owns all results. Concurrent hints coalesce.
The hint is cleared before discovery/cleanup requests so completion during an
in-flight read is not lost. The two-second poll remains the fallback for work
created elsewhere, process restart and dependency recovery.

A visible operation cannot be redispatched more often than the configured poll
interval. This prevents stale/no-op success from creating an immediate retry
loop. The cooldown map retains only currently visible or active IDs. Failed
claims/heartbeats/execution do not produce completion hints, and discovery or
cleanup failures keep the full polling backoff even if a hint arrives. The
existing two-operation concurrency bound is unchanged.

Matched offline result, five samples at the same two-second interval and phase
offsets, Python 3.13.11:

| Synthetic turn work | Completion → speech claim before | After | Discovery requests before / after |
| --- | --- | --- | --- |
| 100 ms | 1902.600 ms | 1.635 ms | 2 / 2 |
| 500 ms | 1501.568 ms | 1.410 ms | 2 / 2 |
| 1000 ms | 1000.088 ms | 1.434 ms | 2 / 2 |
| 1500 ms | 499.832 ms | 1.123 ms | 2 / 2 |
| 1900 ms | 97.783 ms | 1.167 ms | 2 / 2 |

Median falls from 1000.088 to **1.410 ms**; sample p95 from 1902.600 to
**1.635 ms**. These values show the targeted synthetic orchestration wait was
removed, not that a real interview becomes one second faster in every case.
The original baseline predates stage instrumentation in discovery; subsequent
runs include its small local overhead, which is not subtracted from the result.

Completion wake-ups can add an immediate empty discovery after terminal work,
and up to one normal execution per visible ID per poll interval can trigger
additional reads. They do not increase idle polling frequency. Normal failed
claims retain the poll cadence. Synthetic tests cover same-ID no-op results,
concurrent completions, hints during blocked/failed discovery, shutdown and
restart; live production throughput and real provider speed are unmeasured.
