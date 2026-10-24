# Local prompt-injection screening

Set `USER_TEXT_SCREEN_MODEL` to `typesafe:jev-1.13.0`,
`meta-llama/Llama-Prompt-Guard-2-22M`, or `openai:gpt-5-nano`. The default is Jev.
Set `USER_TEXT_SCREEN_FALLBACK_MODEL` to one of the same three models; it runs only
after an attempted primary failure. Setting it to the primary model disables recovery.
`USER_TEXT_SCREEN_TIMEOUT_SECONDS` caps the whole input check, including fallback,
within the caller's task deadline. Jev also has a three-second limit per call.
All three models check prompt injection only.

The worker loads the gated model lazily through Transformers. Provision access to
`meta-llama/Llama-Prompt-Guard-2-22M` in the Hugging Face cache or provide a token through
the worker environment. Keep the token out of repository files and traces. Confirm the
model license and artifact access before deployment. `LABEL_0` allows and `LABEL_1`
blocks; any unexpected configuration or inference output is unavailable and fails closed.
Run `python -m evals.check_local_llama_model` against the real gated artifact to verify
the label mapping on known benign and injection inputs. The production operating
threshold also requires representative evaluation before enabling this setting in production.

Each input is split into overlapping exact substrings near 1,700 characters. The local
tokenizer reduces each chunk further until it fits 512 tokens. Every chunk must allow
before the input can enter a generative prompt. Traces contain the model name, chunk
position, sizes, decision, elapsed time, and error category, but no text or
token. Local inference does not create billed provider usage.
Within one input, up to four chunks classify concurrently. A block stops further
chunk scheduling. Global chunk slots limit active local inferences to four, even
when an earlier input returns while a prefetched chunk is still running.
If a block or outage returns while a prefetched chunk is still running, the task
trace records that chunk as in flight before the caller continues.

Both the synchronous screening path and async input guardrail return an unavailable decision when their deadline expires,
including during model loading. A local inference thread may still finish afterward;
its result cannot approve a source or replace the unavailable decision in the task cache.
Only one input schedules chunks at a time; new checks wait only until their deadline
and do not add threads behind a stalled scheduler. Async checks reuse exact
task-local decisions before waiting for model admission.

For a speed comparison, run `python -m evals.benchmark_screen_models` with both
model credentials available. The benchmark measures cold local loading separately,
then repeats fresh-session benign screens at four input sizes and reports warm p50/p90
latency and attempted chunk counts. It also pairs serial and four-chunk local Llama
screens at 5,000 and 12,000 characters. Jev timing includes its network request time.
Failed or fallback samples remain in the report but do not enter the latency percentiles;
the command exits nonzero if any timed sample fails.
