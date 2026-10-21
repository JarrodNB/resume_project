# Measuring spoken interview latency

These measurements explain waiting in the existing durable interview flow. They
are private engineering evidence, not user analytics or interview quality scores.
Do not change providers, bypass screening/accounting, or reset the retained paid
ledger to obtain a faster number.

## Available evidence and clock domains

The real runtime already configures Logfire, an `interview.operation` span and
Pydantic AI model instrumentation. `interview.stage` adds explicit numeric stage
measurements to that existing tracing setup. Each event contains only a fixed
stage name, elapsed milliseconds, outcome (`completed`, `failed`, `cancelled`)
and, after claim, operation/attempt IDs and claim generation. It never includes
transcripts, prompts, signed URLs, provider errors or personal evidence.
Telemetry failure must not alter execution, cancellation or accounting.

Durations use the Python process's monotonic clock. Never subtract them from
Rails wall-clock timestamps or browser clocks. Events after claim identify each
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
  cg-interview-qa-interview-runtime:latest \
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
  -v "$PWD/services/ai:/app" -w /app cg-interview-qa-interview-runtime:latest \
  pytest -q tests/test_interview_timing.py tests/test_interview_latency_probe.py \
  tests/test_interview_executor.py tests/test_interview_runtime.py
```

Real-provider measurements require actual comparable samples and must remain
within existing authorization/accounting controls. No paid calls were needed
for this baseline. Human microphone/playback and perceived-speed QA remain separate.
