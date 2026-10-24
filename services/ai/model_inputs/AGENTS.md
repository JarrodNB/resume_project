# AGENTS.md — services/ai/model_inputs

## Purpose

Pure, deterministic rendering of model-facing user text from sources selected and
screened by callers. See `README.md` for the boundary and existing domain builders.

## Contents

- `interview.py` — complete question and feedback inputs; shared career projection stays
  in `worker/interview_evidence.py` so exact quote validation and its delimiter test seam
  remain available.
- `tailoring.py` — final section text from approved values and stable source labels.
- `safety.py` — quoted user text for the outage fallback classifier.
- `judge.py` — readable rubric, case input, and output for the interview eval judge.

## Rules

Do not screen, select records, query storage, run agents, or change output schemas here.
Preserve source wording and ordering. Change prompt versions and run the affected evals
if model-facing text changes.
