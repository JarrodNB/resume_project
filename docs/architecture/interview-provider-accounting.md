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
| Speech | JSON `/v1/audio/speech`, `gpt-4o-mini-tts`, `voice=marin`, exact saved `input`, `response_format=wav`, `stream_format=sse`. Concatenate base64 `speech.audio.delta.audio`; require exactly one terminal `speech.audio.done.usage`. | Text input US$0.60/million tokens, generated audio US$12/million tokens = 0.60 and 12 microdollars/token. Require integer positive input/output/total tokens and matching total; round total cost upward. |

Sources: [transcription model/rate](https://developers.openai.com/api/docs/models/gpt-transcribe),
[transcription API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create),
[speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create),
[speech model/rates](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), and
[official OpenAI SSE schema](https://github.com/openai/openai-dotnet/blob/main/specification/base/typespec/audio/models.tsp).
The SSE schema defines base64 audio deltas and terminal input/output/total token counters;
the adapter uses this wire contract without using that SDK. Audio-file length is not a
substitute for reported billed audio tokens. Unsupported/missing usage is unknown.

Blank transcripts and `languages=[]` produce `unusable_audio`, retaining any known cost.
The latter is the documented evidence that no language was reliably detected; it is not a
complete noise detector. Other invalid transcripts never become accepted answers.
Generated speech must fully decode within 10 MiB and 120 seconds. A malformed/truncated
stream, excess response, provider error, cancellation or missing usage retains unknown
cost. Known terminal usage survives a later generated-audio validation failure.

The chosen speech model is deprecated; official
[deprecations](https://developers.openai.com/api/docs/deprecations) list retirement on
6 January 2027. This increment preserves the agreed model. Availability and quality still
need account-level paid checks; no silent replacement is permitted.

## One cumulative verification target

The human approved conservative estimates on 21 October 2026: aim for US$5 total,
reconcile actual charges, and stop after any unknown charge. This is a local verification
target, not a provider-side billing guarantee. The speech API exposes no documented hard
output-token cap; input text limits, download byte limits and timeouts do not prove a
maximum charge. An actual charge may exceed its estimate.

Rails uses server-owned reservation policies, never caller-provided prices:

- gpt-transcribe: 9,000 microdollars (120 seconds at the documented rate).
- gpt-4o-mini-tts: 250,000 microdollars (US$0.25), a deliberately generous **estimate** for
  at most 4,000 saved characters, not a documented maximum.
- Other stage/model/provider combinations currently fail closed. Screening/interviewer
  stages must add a reviewed policy before real wiring. They cannot bypass the budget.

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
user allowance and operation/attempt caps still apply.

At most **one unresolved paid reservation** may exist globally. While a request is in
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
If reliable evidence is unavailable, keep paid verification stopped and report the unknown
charge; never delete ledger rows to keep testing. Existing fake QA data remain available.
