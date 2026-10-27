# Optional AI output streaming

Interactive work has one execution system: Rails commits the operation and durable
fallback, FastAPI starts immediately, and the shared execution runner manages capacity,
leases and shutdown. Feature adapters retain Rails acceptance, screening and accounting.
An optional output sink adds incremental public text. Interviews keep final-result
execution and their existing GraphQL subscription updates.

No production feature currently opts into incremental output. Enabling streaming
configuration alone does not turn interviews into token streams. A future chat adapter
registers with the same runner and declares `stream_output = True`; its Rails feature
adapter supplies ownership/current-attempt checks. It does not add another dispatcher,
claim store, retry policy, supervisor or accounting engine.

## Transport and authority

A streaming adapter emits bounded public `started`, `delta`, `completed`, `failed`,
`cancelled` or `superseded` events through its sink. `completed` means its canonical
acceptance succeeded, not merely that a provider stopped generating. Only `delta`
contains text; tools, private evidence, model messages and arbitrary payload fields
are rejected. Existing privacy, screening, instrumentation and usage finalization stay
active throughout execution.

`authorizeAiExecutionStream` uses the current Rails browser session and CSRF protection.
It authorizes an owned current attempt and returns a 60-second, single-use observer
capability. Rails stores its digest, session binding and fenced attempt identity. A
browser may hold at most eight live capabilities; a scheduled job prunes expired rows
in bounded batches and schedules another batch when needed. Ordinary interview admission
does not issue these capabilities.

The browser connects to `/ai/executions/stream` through the same-origin reverse proxy,
then sends the capability in its first JSON frame, never a URL parameter. Exact Origin
checks and an authenticated fixed-origin Rails callback validate attachment. Readers
obtain a one-second authorization lease before private output, and refresh it at most
once per second rather than running a Rails transaction per token. No private output
is sent while renewal is pending or denied. Logout, account/password invalidation and
abandonment revoke delivery at the next renewal, within one second of the last valid
check. Capability expiry and the local authorization deadline are checked before every
frame, including again after an awaited renewal. Redis generation fencing also
rejects superseded attempts. Reconnect needs a fresh capability and its last cursor.
Each pending send is bounded by the remaining authorization lease and capability
lifetime as well as its ordinary send timeout, including inside a replay batch.
Attachment never claims, starts, retries or cancels execution. Cancellation uses the
feature's existing authenticated Rails mutation; disconnect only removes an observer.

Redis Streams hold a bounded, ephemeral output buffer, keyed by feature, operation,
attempt and generation. Any FastAPI replica can read it with blocking `XREAD`; there is
no HTTP/database discovery loop and no per-token job. A monotonic generation marker
rejects obsolete writers. Each stream retains at most 512 events for five minutes after
its last event, with a 4,096-character delta cap. Readers use bounded batches and send
timeouts; slow observers detach rather than holding up provider execution.

A cursor replays only retained events of the same attempt. Trimmed/missing history,
superseded output, or Redis failure returns `reset` with `saved_state_required`. Clients
then fetch authoritative Rails state and replace provisional text. An initialized sink
cannot recreate a lost stream after Redis restart. Buffer errors disable that sink and
never restart paid work or block canonical result acceptance. Exact token continuation
after an executor or Redis crash is not promised.

If Rails has accepted the result but the final buffer event was lost, observers also
receive a saved-state reset rather than waiting indefinitely for an absent event.

## Optional runtime

Final-only execution neither constructs a Redis client nor adds Redis to readiness,
even if the optional environment flag is enabled. A server-registered streaming feature
and `AI_STREAMING_ENABLED=true` are both required. Configure that flag on Rails and
FastAPI, an explicit `AI_STREAM_REDIS_URL`, and exact `AI_BROWSER_ORIGINS` (which defaults
to the existing interview browser origins).

Local Compose offers Redis only in the `streaming` profile. For a release with an
opted-in adapter, start it with `AI_STREAMING_ENABLED=true docker compose --profile
streaming up`. The Redis port is not published. Its 256 MiB limit uses `noeviction`,
so exhausted memory produces a safe buffer outage rather than unbounded growth.
PostgreSQL remains the source of truth for jobs, accepted results and accounting;
Redis persistence is disabled because this history is replaceable.

In native cloud, export `AI_STREAMING_ENABLED=true` before install/start. The installer
builds optional Redis 8.10.2 under `.native/bin` if absent. Startup manages a loopback
buffer on port 56379 and records its process identity; stop/check use that same identity.
An explicit external `AI_STREAM_REDIS_URL` is preserved and no local Redis is started.
The default native setup requires no Redis. Never expose an unauthenticated buffer
outside the trusted application network; production should configure its supported
private/authenticated Redis endpoint through environment secrets.

## Verification and latency

`tests/test_execution_streaming.py` uses an actual isolated Redis process, two independent
producer/observer instances, synthetic execution and the shared runner. It covers replay,
lease cancellation/finalization, stale writers, authorization failure, slow consumers,
history loss and Redis outages. Rails request/service tests cover real cookies, CSRF,
ownership, single-use grants, session revocation and current-attempt fencing.

Provide `REDIS_SERVER` for the local binary, or an explicit local `AI_TEST_REDIS_URL`
such as `redis://redis:6379/15` when running checks in the Compose streaming profile.
Tests use unique synthetic stream keys and never flush the service database.

With an isolated local Redis running, execute `python -m scripts.stream_latency_probe`
from the AI project. The probe reports p50/p95 admission, relay, first-visible-text
and completion latency at one and eight concurrent streams. Completion ends at the
observer's synthetic `completed` event; Rails acceptance is mocked. It also records
before, sampled peak, after and retained change in bytes for Linux process RSS and
Redis used memory/RSS. Sampling waits 10 ms between reads and includes case boundaries, so short peaks
can be missed; Redis updates its RSS on its own schedule. Process memory includes
both ASGI apps, clients and probe bookkeeping. Redis measurements cover the entire
instance: use an isolated Redis for attribution. Cases retain keys and allocator
memory between runs and never flush Redis. Sampling adds overhead; each short stream
emits three events, so this does not establish sustained token throughput or capacity.
The probe uses real Redis TCP and in-process ASGI
HTTP/WebSocket clients, plus a five-millisecond synthetic provider and mocked Rails
authority. External HTTP/TLS/authentication, actual screening and model latency are
excluded. These measurements verify framework behavior; they are not production SLOs
or model-quality evidence.
