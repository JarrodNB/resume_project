# AGENTS.md — services/ai/model_inputs

## Purpose

Pure, deterministic rendering of model-facing user text from sources selected and
screened by callers. See `README.md` for the boundary and existing domain builders.

## Contents

- `blocks.py` — source-preserving XML-style data boundaries that avoid pasted tag collisions.

- `interview.py` — complete question context shared by workers and evals, plus feedback
  framing. Question text, citation IDs, and quote coverage come from one evidence projection
  in `interview_evidence.py`, including the delimiter test seam.
- `tailoring.py` — cohesive section input and final text from approved values and stable source labels.
- `safety.py` — quoted user text for the outage fallback classifier.
- `judge.py` — readable rubric, case input, and output for the interview eval judge.

## Rules

Do not screen, select records, query storage, run agents, or change output schemas here.
Preserve source wording and ordering. Change prompt versions and run the affected evals
if model-facing text changes.

- `interview_session_feedback.py` — readable role and accepted core-question/follow-up dialogue blocks for completed-session coaching.

- `chat.py` — readable labeled previous summary and accepted exchange prefix; selection/checkpoints remain with Rails and the chat executor.

- `summary_generation.py` — readable labeled career fact blocks; source selection and screening stay outside the renderer.

- `career_library.py` — readable labeled sections, one per screened library entry, for the chat library tool; no IDs or JSON.
