# Spoken interview provider accounting

Rails owns admission and durable usage. The Python audio adapters make one bounded HTTP
request per admitted observation. They never write domain data, change dialogue text,
choose a different model, retry implicitly, or enable a real runtime. Fake sessions still
use their offline executor. No paid requests are needed to test these adapters.

## Provider contracts and rates

Verified 21 October 2026 against official sources:

| Stage | Wire contract | Cost normalization |
| --- | --- | --- |
| Transcription | Multipart `/v1/audio/transcriptions`, `gpt-transcribe`, file name/content type matching validated bytes, `response_format=json`. Validate `text`, optional `languages`, and `usage.type=duration` with positive finite `seconds`. | US$0.0045/minute = 75 microdollars/second; round upward to integer microdollars. Duration is also retained as upward-rounded milliseconds. |
| Live transcription | Server WebSocket `/v1/realtime?intent=transcription`, fixed `gpt-live-transcribe`, transcription session, PCM16 mono 24 kHz, explicit commit. A Rails-owned pre-answer capture admits one connection before provider dispatch. | US$0.017/minute, reserved conservatively as 34,000 microdollars for 120 seconds. Only a valid provider duration receipt establishes actual cost; absent or unsupported usage stays unknown. |
| Speech | JSON `/v1/audio/speech`, `gpt-4o-mini-tts`, `voice=marin`, exact saved `input`, `response_format=wav`, `stream_format=sse`. Concatenate base64 `speech.audio.delta.audio`; require exactly one terminal `speech.audio.done.usage`. | Text input US$0.60/million tokens, generated audio US$12/million tokens = 0.60 and 12 microdollars/token. Require integer positive input/output/total tokens and matching total; round total cost upward. |

Sources: [transcription model/rate](https://developers.openai.com/api/docs/models/gpt-transcribe),
[transcription API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create),
[speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create),
[speech model/rates](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), and
[official OpenAI SSE schema](https://github.com/openai/openai-dotnet/blob/main/specification/base/typespec/audio/models.tsp).
The SSE schema defines base64 audio deltas and terminal input/output/total token counters;
the adapter uses this wire contract without using that SDK. Audio-file length is not a
substitute for reported billed audio tokens. Unsupported/missing usage is unknown.

Live protocol and price were checked on 22 October 2026 against the [official transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
and [pricing](https://developers.openai.com/api/docs/pricing). Live captures have separate
task and observation identities because an answer turn requires a sealed recording and
does not exist while the candidate is speaking. Admission persists an unknown-usage marker
before the socket opens. Disconnect, cancellation, rejected final text and missing receipts
retain that evidence; a late actual receipt may reconcile it without accepting late text.
Browser recognition skips a transcription provider dispatch when finalized text is saved
with the submitted turn. See [answer modes](../interview-transcription.md) for fallback and
device checks. No account-level paid live-model verification is implied by offline tests.

Blank transcripts and `languages=[]` produce `unusable_audio`, retaining any known cost.
The latter is the documented evidence that no language was reliably detected; it is not a
complete noise detector. Other invalid transcripts never become accepted answers.
Generated speech must fully decode within 10 MiB and 120 seconds. A malformed/truncated
stream, excess response, provider error, cancellation or missing usage retains unknown
cost. Known terminal usage survives a later generated-audio validation failure.

The speech reader finishes at a complete, validated `speech.audio.done` event rather
than waiting for the HTTP connection to close. The [audio event reference](https://platform.openai.com/docs/api-reference/audio)
defines that event as synthesis complete with all audio streamed. Arbitrary network
chunks, CRLF and multiline SSE fields are handled before recognition; all complete events
received in the terminal chunk still undergo the existing malformed/trailing-event
validation. The response byte cap and 40-second total/30-second inactivity bounds remain.

Audio request failures emit content-free diagnostics to the runtime log: endpoint,
header/body phase, HTTP status when available, exception class, received byte count and
elapsed time. Request/response bodies, headers, request IDs, credentials and exception
messages are omitted. These fields distinguish a timeout waiting for headers from a
timeout while receiving audio; a 30-second failure alone does not establish its phase.

The chosen speech model is deprecated; official
[deprecations](https://developers.openai.com/api/docs/deprecations) list retirement on
6 January 2027. This increment preserves the agreed model. Availability and quality still
need account-level paid checks; no silent replacement is permitted.

## One cumulative verification target

### Development-only unmetered local testing

The real browser-QA overlay explicitly sets `INTERVIEW_LOCAL_TESTING_UNMETERED=true`.
Only Rails development honors it. This mode skips unknown-cost and cumulative US$5
verification admission gates, plus interview monthly/hourly allowance gates. It retains
the original ledger, preregistered provider identities, pricing allowlist, all estimates,
actual reconciliation, owner scoping, lease fences and resource/attempt limits. General AI
allowances and non-development admission are unchanged. The launcher honors the same mode;
local testing no longer requires approving each new unresolved observation.

The 250,000-microdollar speech estimate is local bookkeeping, not money reserved with
OpenAI, a confirmed charge or a card hold. Unknown estimates stay recorded without being
assigned zero or deleted. Outside this explicit local mode, the verification rules below
remain enforced.

### Explicitly reviewed historical unknowns when verification is enforced

The default remains stop-on-unknown. After new human authorization, a development-only
paid verification process may set `INTERVIEW_REVIEWED_UNKNOWN_OBSERVATIONS` to a comma-separated
list of exact historical observation UUIDs. This requires both Rails development mode and
`INTERVIEW_PAID_VERIFICATION=true`; the paid Compose overlay passes the list to Rails.
Reviewed rows remain unresolved and count at their full reserved estimates toward the same
US$5 target. A new unknown observation blocks all subsequent calls again. This neither
reconciles old charges nor resumes old operations. Inspect pending work first and claim only
the explicitly selected diagnostic operations; the general paid harness still refuses old
unknown usage and pending work. Remove the override after the diagnostic and stop execution.

The human approved conservative estimates on 21 October 2026: aim for US$5 total,
reconcile actual charges, and stop after any unknown charge. This is a local verification
target, not a provider-side billing guarantee. The speech API exposes no documented hard
output-token cap; input text limits, download byte limits and timeouts do not prove a
maximum charge. An actual charge may exceed its estimate.

Rails uses server-owned reservation policies, never caller-provided prices:

- gpt-transcribe: 9,000 microdollars (120 seconds at the documented rate).
- gpt-4o-mini-tts: 250,000 microdollars (US$0.25), a deliberately generous **estimate** for
  at most 4,000 saved characters, not a documented maximum.
- Jev screening: 10,000 microdollars (US$0.01); Nano safety fallback and Luna interviewer:
  50,000 microdollars each (US$0.05). These deliberately generous token estimates cover
  bounded prompts, with OpenAI output capped at 1,024 tokens for dialogue/screening or
  4,096 for the complete preparation plan per concrete request.
  They are estimates rather than hard provider ceilings; actual usage is reconciled.
- All other stage/model/provider combinations fail closed. No generative fallback or
  configurable pricing is enabled by this policy.

`InterviewVerificationReservation` is an anonymous permanent ledger with no cascading
owner/session association. It survives expiry, deletion, process restarts and retries.
Each observation retains its reserved amount and nullable actual charge. There is one
allowance across all owners in the configured verification database, not one per user,
process, session, container, or test runner. Do not create another paid verification
database or reset its volume to renew this allowance.

Admission locks owner → interview → questions → operation/task, then takes a fixed
transaction-scoped PostgreSQL advisory lock for the verification ledger. All admission
and known-cost reconciliation use that final lock. The transaction includes registration
and the unfinished usage marker; no provider I/O runs under database locks. Existing
user allowance applies when enabled; resource and operation/attempt caps always apply.

By default, at most **one unresolved paid reservation** may exist globally. While a request is in
flight, another paid admission is refused. A crash, lost receipt or unknown/error report
leaves that reservation unresolved and blocks every subsequent paid verification call,
even when budget remains or the old claim expires. There is no automatic timeout release.
Once reliable late usage arrives, Rails reconciles that observation exactly once and may
admit another request if actual totals plus its reservation fit the remaining target.
Execution-completion summaries cannot release provider reservations or charge them again.
Conflicting known reports fail; repeated matching reports and later unknown reports do
not change known totals. Shared queued-task finalized-report behavior is unchanged.

A lost registration response sends no provider request but conservatively leaves an
unresolved reservation. Recover only by reconciling reliable provider evidence through
the original scoped observation callback. If the owning operation/account was deleted,
that callback is unavailable: an operator must verify the provider receipt and reconcile
the original observation with `Interviews::VerificationBudget.reconcile` inside an explicit
`ApplicationRecord.transaction` in the Rails console. Verified evidence that no dispatch
occurred may establish actual zero; this operator path permits zero, while automatic
real-provider usage reports continue to reject it as an unsafe fallback. Do not create an automatic release,
a public reconciliation endpoint, or an inferred zero charge. The helper requires an open
transaction so its transaction-scoped advisory lock remains held until the update commits.
If reliable evidence is unavailable, keep the actual cost unknown. Enforced verification
remains stopped; local unmetered QA can continue without changing that record. Never delete
ledger rows to keep testing. Old fake QA data remain retained offline.

## Accounted reasoning and screening

The real turn executor reuses the fake executor's validated storage, transcript limits,
masked prompt assembly, bounded input integrity and acceptance callback. Preparation and real turns use no injection classifiers or source approval callbacks.
It injects real transcription and a fresh single-run Pydantic AI interviewer. Public real
admission and runtime startup require explicit development enablement. The
[real QA guide](../interview-real-qa.md) uses the retained paid ledger. Rails still
chooses progression and creates speech work only from accepted saved text.

Every concrete Pydantic AI model request runs through `InterviewModel` and `ProviderCalls`,
below output validation. Retries and the tool-return request each need a fresh durable
reservation. Known usage is saved before Pydantic validates output. Zero/missing usage or
an unexpected response model remains unknown and stops processing. Only the exact approved
model name (optionally provider-prefixed) is priced; unverified snapshot aliases fail closed.
The existing pure worker price helper normalizes token usage, including cached tokens.
Library-informed preparation shares the approved Luna interviewer stage and its existing
US$0.05 reservation estimate; each concrete request still needs its own durable observation.
Only preparation reasoning raises the bounded output cap to 4,096 tokens to fit the role
and all nine questions. Ordinary interview dialogue and Nano screening remain at 1,024.
No new model or rate is introduced; the cumulative verification allowance is unchanged.
Actual usage is reconciled as before.

Full prepared sessions share one hourly admission, while preparation, every turn and every
speech retain separate task/attempt/provider bills. The current hourly default is 30;
session grouping does not itself bypass interview allowances. Local unmetered QA explicitly
skips spend/start enforcement, while concurrency and this permanent ledger remain intact.
General AI allowances exclude spoken interview work;
its actual bills and unknown markers remain intact in the same durable accounting tables. See [session accounting](interview-sessions.md#http-execution-accounting)
for ownership checks, finite submission limits and task-month attribution.

The interview wrapper explicitly requests Standard (`service_tier: "default"`) pricing.
Luna uses `prompt_cache_options: {"mode": "explicit"}` without breakpoint markers:
[official caching guidance](https://developers.openai.com/api/docs/guides/prompt-caching)
confirms this creates no cache writes. The pinned Pydantic mapper preserves total write
tokens but drops the 30-minute/12-hour split, so silently pricing writes as ordinary input
would undercount. Unexpected Luna write tokens leave usage unknown and stop later paid
dispatch when verification is enforced. Local unmetered QA retains the unknown record without
that global stop. Nano retains its older implicit caching behavior; unrelated worker pricing is
unchanged.

The feature supports Luna's Standard short-context rates only. If reported input exceeds
272,000 tokens, its observation remains unknown instead of applying an unsupported rate.
The [model contract](https://developers.openai.com/api/docs/models/gpt-6-luna) applies
higher rates above that boundary. The existing character-bound prompt checks are not a
token-count guarantee; this post-response guard preserves truthful accounting and the
unknown-cost record (and enforced stop where enabled), rather than promising a provider-side maximum bill.

Verified 21 October 2026: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
is US$0.10/0.01/0.50 per million input/cached/output tokens; [Nano](https://developers.openai.com/api/docs/models/gpt-5-nano)
is US$0.05/0.005/0.40. [Jev 1.13](https://docs.typesafe.ai/models) is US$0.042/million
input tokens with free output. Standard default service tier is used. The pinned SDK
source (`typesafe_sdk.AsyncTypeSafeClient`, `pydantic_ai.providers.typesafe`) supports
`RetryPolicy(max_retries=0)`; OpenAI uses `AsyncOpenAI(max_retries=0)`. Both transports
also disable retries and environment proxy configuration. No provider request runs at import.

Required transcripts and unknown user/tool history use the repository's shared Jev policy
and official InputGuardrail. Missing TypeSafe credentials fail closed. After an attempted
Jev failure the shared Nano fallback is still selected, but it too must pass fresh Rails
admission: an unresolved Jev charge blocks it. Known input/output usage from an invalid
classifier result can be reconciled before that fallback. A failed classifier cannot become
an assumed zero charge to permit more spending. The interviewer never silently substitutes
another generative model.

`python -m evals.run_spoken_interviewer_evals` checks synthetic dataset/schema/evaluator
wiring offline only. Its deterministic label scores do not demonstrate model quality.
Paid quality evaluation needs a later runner using the admitted execution boundary and remains deferred.

The pinned Pydantic AI 2.53.0 TypeSafe `DecisionModel.request` can send route and field
requests separately for more complex agents. This path is deliberately limited to the
existing safety agent's one structured output containing two boolean fields, with no
function tools. Its single-output branch executes exactly one `_decide`; a successful
real-SDK mocked-transport regression proves one HTTP request per observation. Widening
that classifier's schema or adding tools requires revisiting accounting at the wire seam.
