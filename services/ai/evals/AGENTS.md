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
- `datasets/job_posting_extraction_cases.yaml` — 8 synthetic LinkedIn postings written in
  LinkedIn's description markup (bold and colon headings; curly apostrophes; plain-text
  sub-headings; minimum vs preferred; "what you should have" / "bonus points"; nested lists; no
  headings; unrecognized headings; prose only), hand-labelled requirements and nice-to-haves
- The runner's `linkedin_case_to_page` builds each case's JobPage the way the scraper does
- `job_posting_extraction_evaluators.py` — `RequirementMatch` (precision/recall),
  `VerbatimBullets`, `SortedByExpectedPath` (the LLM only runs when headings don't match),
  `PostingFieldsMatch`
- `run_job_posting_extraction_evals.py` — runner (heading split + real sorting agent):
  `docker compose run --rm ai python -m evals.run_job_posting_extraction_evals`
- `datasets/gap_analysis_cases.yaml` — 7 synthetic job + career library pairs (strong match,
  obvious gaps, adjacent skills are partial, requirement shown only by a project, synonyms and
  equivalent degree, fewer years than asked, near-empty library) with hand-labelled verdicts
  (plus acceptable alternatives) and key evidence ids
- `gap_analysis_evaluators.py` — `Coverage`, `EvidenceValidity`, `VerdictAccuracy`
  (incl. met agreement), `GapRecall`, `EvidenceRecall`
- `run_gap_analysis_evals.py` — runner (fixed "today" so year counts are stable):
  `docker compose run --rm ai python -m evals.run_gap_analysis_evals`

## Local Rules

- All data is synthetic. Never commit real resumes.
- `tests/test_resume_parsing_evaluators.py`, `tests/test_job_posting_extraction_evaluators.py`,
  and `tests/test_gap_analysis_evaluators.py` check that the hand labels score 1.0 against their own inputs; keep them passing when adding
  cases.
- Runs cost real tokens (about $0.02 for the resume parsing set and $0.01 for the gap
  analysis set on gpt-5-mini).
