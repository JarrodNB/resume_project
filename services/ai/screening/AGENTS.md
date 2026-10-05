# AGENTS.md — services/ai/screening

## Purpose

Decide whether user-written text may enter a prompt. Jev answers two yes/no questions; code
applies the threshold. This is not a second classifier and it does not choose allow or block.

## Contents

- `screen_user_text.py` — `screen_user_text`: phrase check, then Jev, then the 0.7
  yes-confidence threshold. A missing key or a Jev error returns not allowed and does not send
  the text. Blank text is allowed without a call
- `obvious_instruction_override.py` — a short phrase list for obvious instruction overrides
- `yes_confidence.py` — recovers P(yes) from Jev's bool margin and `blocks_on_yes_confidence`

## Local Rules

- Do not send the text when the screen cannot run.
- Career-library entries copied from a resume are not passed here.
- Report Jev `ModelUsage` on the task result when a call was made.
