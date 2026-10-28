# Measuring interactive AI latency

Normal interview work starts through the shared HTTP executor immediately after Rails
commits the operation and its fallback job. No discovery interval precedes execution.
Interviews keep final-result delivery; future chat can use optional streamed output on
the same runner. Measurements are engineering evidence, not model-quality scores.

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

Parent agent timings include nested screening; do not sum them twice. Browser upload,
review time, subscription delivery, playback and first audible speech need their own
measurements. Existing checks do not infer those numbers from backend acceptance.

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
