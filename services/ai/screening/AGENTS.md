# AGENTS.md — services/ai/screening

## Purpose

Decide whether user-written text may enter a prompt. Jev answers two yes/no questions; code
applies the threshold. This is not a second classifier and it does not choose allow or block.

## Contents

- `prompt_guardrail.py` — async `screen_prompt` policy for official Harness `InputGuardrail`,
  registered through `capabilities` on every generative agent. Enforces exact source coverage
  and screens unknown direct input and user/tool history, under the prompt cap. Blocks fail
  with `InputBlocked`; usage caps propagate. No phrase prefilter on assembled context.
- `guardrail_usage.py` — task-scoped capability usage accounting, including blocked runs.
- `screen_user_text.py` — `screen_user_text`: a string over the screen cap returns not allowed
  with `too_long` and does not call Jev. Then the phrase check (skipped for a whole resume),
  then Jev, then the 0.7 yes-confidence threshold. A missing key or a Jev error returns not
  allowed with `unchecked` and does not send the text. A request, tool-call, or token cap is
  re-raised. Blank text is allowed without a call
- `obvious_instruction_override.py` — a short phrase list for obvious instruction overrides
- `yes_confidence.py` — recovers P(yes) from Jev's bool margin and `blocks_on_yes_confidence`

## Local Rules

- `library_inputs.py` — cohesive optional library entry selection and reconstruction from
  checked source values; shared by gap analysis and interviews.
- `session.py` owns execution-local decisions and exact
  prompt coverage. The worker opens a fresh `screening_session` for every delivery;
  standalone handlers/wrappers use `within_screening_session` to reuse an enclosing scope.
  `screen_user_text` checks 4,000-character chunks with 300 characters of overlap by
  default. The 2,000 candidate remains configurable for repeat evaluation. The live
  synthetic comparison found identical decisions with fewer requests for 4,000;
  it does not establish a general detection advantage over whole-document screening.
  `bind_screened_prompt(sources, render)` grants exact rendered-prompt coverage only when
  every supplied source has an allowed decision. Renderers are trusted application code:
  all untrusted values must come from the supplied source arguments, never closure state.
  Empty sources cannot grant coverage. Unknown history and changed prompts remain guarded.
  Migrated wrappers bound generation with `remaining_timeout` to share the task deadline.

- Do not send the text when the screen cannot run.
- Screen each input once per execution. A later delivery, retry, or resumed task screens
  reused content again. Required inputs fail closed; optional entries can be omitted.
- Never grant coverage by substring matching, a persisted approval, or a caller-controlled
  boolean. A trusted renderer must reconstruct every untrusted value from supplied sources.
- Jev must not carry its own input guardrail (that would recurse).
- Preserve guard ordering for each input: a blocked input must never reach the generative
  provider. Independent source checks may overlap with a bounded concurrency limit.
  Concurrent checks of the same exact source and policy share one execution-local decision.
- Report Jev `ModelUsage` on the task result when a call was made.
