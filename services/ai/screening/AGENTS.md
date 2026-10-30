# AGENTS.md — services/ai/screening

## Purpose

Decide whether user-written text may enter a prompt. JEV answers a prompt-injection
yes/no question; code applies the confidence threshold. Primary and fallback each select
Jev, local Llama, or a configurable LLM. Screening owns recovery and returns a small decision interface.

## Contents

- `conversation.py` — chat and spoken-interview newest-message screening and exact
  latest-prompt guard. Callers reconstruct history from authenticated Rails accepted public
  dialogue, never caller-controlled private model history. `screen_with_operation_models`
  runs fixed Jev with a Nano fallback on models billed to the caller's operation. It does
  not change `screen_prompt` or queued tasks.

- `local_llama.py` — optional local Llama Prompt Guard 2 22M prompt-injection classifier.
  Exact overlapping substrings are checked against the tokenizer's 512-token limit before
  inference. Model loading and inference errors remain unavailable checks. It does not
  classify harmful requests or report provider token charges.

- `prompt_guardrail.py` — async `screen_prompt` policy for official Harness `InputGuardrail`,
  registered through `capabilities` on every generative agent. Enforces exact source coverage
  and screens unknown direct input and user/tool history, under the prompt cap. Blocks fail
  with `InputBlocked`; usage caps propagate. No phrase prefilter on assembled context.
  `prompt_input_texts` lists the texts a guard must cover; spoken-interview guards reuse it.
  `screening_failure_message` / `screening_failure_code` are the only wording and Rails codes
  for a rejected outcome; too-long text is never reported as unsafe.
- `guardrail_usage.py` — task-scoped capability usage accounting, including blocked runs.
- `screen_user_text.py` — text over the cap returns `too_long` without any provider call.
  A short note gets a phrase prefilter; whole resumes skip it. JEV gets at most three
  seconds per call and keeps the 0.7 confidence bar. Attempted primary failures use the
  configured fallback within the remaining screening deadline. Prompt injection blocks.
  Missing Jev credentials prevent Jev calls; failed recovery
  returns `unchecked`. Limits and cancellation propagate. Blank text is free.
  `model_usages` retains completed calls by model; compatibility totals exist only for
  single-model passes. Cached decisions return no usage. Worker request accounting remains
  authoritative for failed runs and output-validation retries. Drivers notify the independent
  logging module immediately before fallback execution; no input text is included.
- `records.py` — the shared path for saved database records (`screen_records`, sync
  `screen_records_sync`). Skips approved or already-fingerprinted fields, screens the rest
  as one labeled blob (split only past the masked screen cap, records kept whole) with no
  phrase check, fails the whole call on any rejected blob, and writes one `RecordScreening`
  receipt per saved record. Only the fields a caller uses are screened. Chat and interviews
  pass their operation-billed `screen` function.
- `record_adapters.py` — pure snapshot-to-`ScreenableRecord` functions (library, job,
  gap responses, interview answers, summary sources). Types, ids and fingerprints match the
  older modules' receipts. Summary sources have no record ids, so they are never reported. Workflows move onto it one at a time; see the record-screening plan.
- `obvious_instruction_override.py` — a short phrase list for obvious instruction overrides
- `yes_confidence.py` — recovers P(yes) from Jev's bool margin and `blocks_on_yes_confidence`

## Local Rules

- `interview_question_fields.py` — written answer checks shared by feedback and regeneration.
  Exact field decisions may share work, but every saved ID/revision is reported. Regeneration
  trusts question text supplied in its Rails-owned task snapshot, including legacy siblings
  without aligned metadata. Generated questions are never screened again. Complete-source
  caps apply to answer approvals.

- `gap_response_fields.py` — groups pending requirement/body fields from queued answer
  snapshots, preserving every saved ID through text deduplication. Full group limits apply
  even to reused approvals; legacy no-ID snapshots cannot reuse persisted checks. Exact
  field payload decisions are execution-local; only Rails persists fingerprinted reports.

- `job_fields.py` — sync/async saved Job checks shared by gap analysis and tailoring.
  Only title, company, requirements and nice-to-haves can earn approvals; lists are ordered
  whole fields. Canonical UTF-8 JSON fingerprints match Ruby stdlib JSON.generate, not
  Rails HTML escaping. Callers retain complete-source limits and bind only these used fields.

- `library_inputs.py` — bounded whole-library checking and reconstruction from
  checked source values for interviews and the chat library tool, on `screen_records`.
  The sync variant uses the configured classifier and returns its usage (also on
  `LibraryScreeningError`); the async variant takes the caller's billed `screen`.
- `interview_question_inputs.py` — reconstructs the checked library and generated history
  inside exact prompt binding, returning the same complete question context used by evals.
  Source approval and generated-text provenance remain the caller's responsibility.
- `library_fields.py` — reuse database field approvals and report new successful checks over
  final task results. Callers choose used fields and keep complete-source limits. Metadata
  stays outside prompt serialization; only Rails persists approvals and clears edited fields.
- `session.py` owns execution-local decisions and exact
  prompt coverage. The worker opens a fresh `screening_session` for every delivery;
  standalone handlers/wrappers use `within_screening_session` to reuse an enclosing scope.
  `screen_user_text` checks 4,000-character chunks with 300 characters of overlap by
  default. The 2,000 candidate remains configurable for repeat evaluation. The live
  synthetic comparison found identical decisions with fewer requests for 4,000;
  it does not establish a general detection advantage over whole-document screening.
  `bind_screened_prompt(sources, render)` grants exact rendered-prompt coverage only when
  every supplied source has an allowed decision or explicit, validated generated-output
  provenance in this execution. Renderers are trusted application code:
  all untrusted values must come from the supplied source arguments, never closure state.
  Empty sources cannot grant coverage. Unknown history and changed prompts remain guarded.
  Migrated wrappers bound generation with `remaining_timeout` to share the task deadline.

- Do not send the text when the screen cannot run.
- Screen each input once per execution. Saved Job, gap-response, written practice and career-library fields reuse persisted
  checks across tasks; unchecked fields and other input screen again on later deliveries.
  Required inputs fail closed; library batches also fail the operation on any rejected
  check or exceeded bound, rather than dropping entries. Other optional inputs retain their own policy.
- Never grant coverage by substring matching or a caller-controlled boolean.
  Saved library checks can authorize exact sources reconstructed from their approved fields.
  `trust_generated_source` is only for immutable output from an owned completed AI task;
  never use it for user-editable text or external content.
  `trust_rails_screened_source` is only for immutable text Rails accepted after a successful
  screen and hands over through an authenticated grant (completed interview dialogue); it
  keeps its own session set and never covers editable records.
  A trusted renderer must reconstruct every untrusted value from supplied sources.
- Neither safety classifier carries an input guardrail (that would recurse).
- Preserve guard ordering for each input: a blocked input must never reach the generative
  provider. Independent source checks may overlap with a bounded concurrency limit.
  Concurrent checks of the same exact source and policy share one execution-local decision.
- Report each actual classifier model's usage, including retries and calls before failure.

## Scoped Exceptions

- Scraped-ad parsing (`agents/parse_scraped_job_posting_agent.py`) uses a source-boundary
  and size guard instead of injection classification, authorized after a synthetic injection
  evaluation. It accepts one selected ad, no history, action tools or private context, keeps
  source validators and execution limits, and grants no approvals to its output. Pasted ads
  and later uses of saved job content keep the normal policy.
- A validated completed gap-analysis result can be trusted as generated output within one
  tailoring execution. Saved gap-response requirement/body approvals are reused; pending
  fields are screened together once, with fingerprinted reports for every saved answer ID.
- Spoken interviews reconstruct prior dialogue from Rails-owned public utterances and screen
  only the newest candidate message. Frozen library approvals travel in the private claim;
  new checks persist through its fenced Rails callback before generation. Preparation also
  persists an exact frozen career-focus fingerprint there and needs its receipt first,
  including focus-only checks; retries reuse only matching fingerprints. Ordinary queued
  Job checks cover title, company, requirements and nice-to-haves; interviews also freeze and
  check description and responsibilities, sharing that receipt. Saved-job preparation outputs
  `role: null` so Rails keeps the authoritative job.
