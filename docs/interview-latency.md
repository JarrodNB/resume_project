# Measuring interactive AI latency

Normal interview work starts through the shared HTTP executor immediately after Rails
commits the operation and its fallback job. No discovery interval precedes execution.
Interview answer turns publish optional streamed spoken text on the same runner as chat;
saved results still arrive as final results. Measurements are engineering evidence, not model-quality scores.

## Separate the clock domains

Measure admission/commit-to-first-provider-request, provider time, and result delivery
separately. Do not subtract a Python monotonic clock from Rails or browser timestamps.
Rails operation/attempt timestamps can describe initial admission and later retries on
one clock. Keep failures, retry backoff and lease recovery separate from successful turns.

The optional local `interviews.timing` DEBUG records contain only stage/outcome, duration,
operation ID and fenced attempt/generation. They exclude prompts, audio capabilities,
provider exceptions and user details. Logfire retains the ordinary operation/model traces.

| Stage | Included work |
| --- | --- |
| `claim` | Scoped Rails claim request before a trusted claim exists |
| `recording_download` | Capability, private download and audio validation |
| `transcription` | Transcription adapter plus admission/usage callbacks |
| `screening` | Screening, chunks, fallbacks and accounting |
| `interviewer` / `preparation` | Agent execution, tools and validation |
| `speech_synthesis` | Exact accepted-text synthesis and accounting |
| `speech_storage` | Reservation, upload and sealing |
| `acceptance` | Durable callback and ambiguous-receipt reconciliation |

Parent agent timings include nested screening; do not sum them twice. Existing checks do
not infer browser-side numbers from backend acceptance; the browser records its own below.

## Browser stages

`apps/web/src/features/interviews/interviewLatency.ts` records what only the browser can see as
`performance.measure` entries named `interview:<stage>`. Entries hold a duration, a mode and
nothing else: no text, audio or IDs, and nothing is sent to a server. They use the page's own
clock, so do not join them to Rails or Python timestamps.

| Stage | Starts | Ends | Mode |
| --- | --- | --- | --- |
| `speech-end-to-transcript` | Pause recording in a live mode | Final recognized text is in the answer box | `browser` / `streaming` |
| `recording-to-transcript` | Transcribe recording (includes upload) | Transcript fills the answer box | `recorded` |
| `submit-to-reply` | Submit answer | The next interviewer prompt appears | `all` |
| `reply-to-audio` | The next prompt appears | Its automatic playback makes sound | `browser` / `provider` |
| `submit-to-audio` | Submit answer | The next prompt's automatic playback makes sound | `browser` / `provider` |

A failed recognition, failed submission or manual (non-automatic) playback records nothing for
that stage, so the numbers never include reading or thinking time. In provider mode,
`reply-to-audio` includes speech generation, storage and the playback grant. Browser "sound" is
the first sentence's `onstart` event, which some voice engines fire slightly early.

To collect numbers, run several turns at `/practice/interviews`, then in the DevTools console:

```js
console.table(__interviewLatency.report())
```

The report gives count, p50, p95 and max per stage and mode for the current page load. Entries
also appear in the DevTools Performance panel under Timings. Compare one device, network and
mode at a time, and record those alongside the results.

## Repeatable local HTTP dispatch probe

The common probe starts a real loopback HTTP server, authenticates execution requests,
and runs the actual `ExecutionRunner` with a deterministic immediate adapter:

```bash
cd /workspace/resume_project/services/ai
uv run --no-sync python -m scripts.execution_latency_probe --samples 50 --concurrency 1
uv run --no-sync python -m scripts.execution_latency_probe --samples 50 --concurrency 5
```

For local Docker, run the same module through `ai-worker` with `--no-deps`. Loopback is
required; no Rails, Redis, queue consumer or provider connection is made. The report gives
p50/p95 HTTP receipt and execution-start delay, sample/concurrency/capacity, success/error
counts, and explicit exclusions. Use the same workload/environment for comparisons.

These numbers exclude Rails transactions, real network hops, screening, model generation,
stream transport and browser rendering. They demonstrate direct start without a queue
consumer; they are not a production first-token or end-to-end interview latency guarantee.

Focused offline checks:

```bash
uv run --no-sync pytest -q tests/test_execution_dispatch.py tests/test_execution_latency_probe.py \
  tests/test_interview_timing.py tests/test_interview_runtime.py tests/test_interview_executor.py
```

The Rails immediate-preparation and cutover integration tests separately prove atomic
commit-before-nudge, lost-nudge fallback, duplicate delivery, exact-lease recovery and
legacy-work adoption. Existing provider screening/accounting controls remain required;
do not bypass them or reset retained billing records to obtain a faster sample.
