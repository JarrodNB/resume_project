# AGENTS.md — services/ai/screening

## Purpose

Decide whether user-written text may enter a prompt. JEV answers two yes/no questions; code
applies the confidence threshold. After an attempted JEV failure, a separate Nano classifier
answers strict booleans. Screening owns recovery and returns a small decision interface.

## Contents

- `conversation.py` — interview-only newest-message screening and exact latest-prompt guard.
  Its caller reconstructs history from authenticated Rails accepted public dialogue, never
  caller-controlled private model history. It does not change `screen_prompt` or queued tasks.

- `prompt_guardrail.py` — async `screen_prompt` policy for official Harness `InputGuardrail`,
  registered through `capabilities` on every generative agent. Enforces exact source coverage
  and screens unknown direct input and user/tool history, under the prompt cap. Blocks fail
  with `InputBlocked`; usage caps propagate. No phrase prefilter on assembled context.
- `guardrail_usage.py` — task-scoped capability usage accounting, including blocked runs.
- `screen_user_text.py` — text over the cap returns `too_long` without any provider call.
  A short note gets a phrase prefilter; whole resumes skip it. JEV gets at most three
  seconds and keeps the 0.7 confidence bar. Attempted JEV failures use the configured
  safety fallback on the same protected chunk within remaining time. Either fallback
  boolean being true blocks. Missing credentials call neither provider; failed recovery
  returns `unchecked`. Limits and cancellation propagate. Blank text is free.
  `model_usages` retains completed calls by model; compatibility totals exist only for
  single-model passes. Cached decisions return no usage. Worker request accounting remains
  authoritative for failed runs and output-validation retries. Drivers notify the independent
  logging module immediately before fallback execution; no input text is included.
- `obvious_instruction_override.py` — a short phrase list for obvious instruction overrides
- `yes_confidence.py` — recovers P(yes) from Jev's bool margin and `blocks_on_yes_confidence`

## Local Rules

- `library_inputs.py` — cohesive optional library entry selection and reconstruction from
  checked source values for interviews, reusing saved field checks through `library_fields.py`.
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
- Screen each input once per execution. Saved career-library fields reuse database
  checks across tasks; unchecked fields and other input screen again on later deliveries.
  Required inputs fail closed; optional entries can be omitted.
- Never grant coverage by substring matching or a caller-controlled boolean.
  Saved library checks can authorize exact sources reconstructed from their approved fields.
  `trust_generated_source` is only for immutable output from an owned completed AI task;
  never use it for user-editable text or external content.
  A trusted renderer must reconstruct every untrusted value from supplied sources.
- Neither safety classifier carries an input guardrail (that would recurse).
- Preserve guard ordering for each input: a blocked input must never reach the generative
  provider. Independent source checks may overlap with a bounded concurrency limit.
  Concurrent checks of the same exact source and policy share one execution-local decision.
- Report each actual classifier model's usage, including retries and calls before failure.
