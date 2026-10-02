# AGENTS.md — services/ai/evals

## Purpose

Pydantic Evals datasets, evaluators, and runners that measure agent quality against the real
model. Each run is one Langfuse trace (agent calls nested inside) with the average of every
score attached, so runs can be compared across prompt and model changes.

## Contents

- `datasets/resume_parsing_cases.yaml` — 5 synthetic, hand-labelled resumes (clean, year-only
  dates, messy two-column extraction, ambiguous entries, not a resume)
- `resume_parsing_evaluators.py` — deterministic evaluators: `SourceFaithfulness`,
  `ExperienceMatch`, `SectionRecall`, `WarnsWhenAmbiguous` (matching helpers come from
  `documents/text_matching.py`, shared with the production faithfulness guard; evals score the
  raw agent output, before that guard runs)
- `run_resume_parsing_evals.py` — runner:
  `docker compose run --rm ai python -m evals.run_resume_parsing_evals`

## Local Rules

- All data is synthetic. Never commit real resumes.
- `tests/test_resume_parsing_evaluators.py` checks that the hand labels score 1.0 against
  their own inputs; keep it passing when adding cases.
- Runs cost real tokens (about $0.02 for the resume parsing set on gpt-5-mini).
