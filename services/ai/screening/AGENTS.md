# AGENTS.md — services/ai/screening

## Purpose

Decide whether user-written text may enter a prompt. Jev answers two yes/no questions; code
applies the threshold. This is not a second classifier and it does not choose allow or block.

## Contents

- `prompt_guardrail.py` — async `screen_prompt` policy for official Harness `InputGuardrail`,
  registered through `capabilities` on every generative agent. Sequentially screens the entire
  assembled text and supplied user/tool history with Jev, under the prompt cap. Blocks fail
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

- Do not send the text when the screen cannot run.
- Field-level screening provides early errors/omissions; the agent capability independently
  screens the final prompt, including imported, manually edited, retrieved, and scraped text.
- Jev must not carry its own input guardrail (that would recurse).
- Keep guards sequential: a blocked input must never reach the generative provider.
- Report Jev `ModelUsage` on the task result when a call was made.
