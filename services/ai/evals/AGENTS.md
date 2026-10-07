# AGENTS.md — services/ai/evals

## Purpose

Pydantic Evals datasets, evaluators, and runners that measure agent quality against the real
model. Each run is one Langfuse trace (agent calls nested inside) with the average of every
score attached, so runs can be compared across prompt and model changes.

## Contents

- `datasets/resume_parsing_cases.yaml` — 6 synthetic, hand-labelled resumes (clean, year-only
  dates, messy two-column extraction, ambiguous entries, not a resume, an embedded instruction)
- `resume_parsing_evaluators.py` — deterministic evaluators: `SourceFaithfulness`,
  `ExperienceMatch`, `SectionRecall`, `WarnsWhenAmbiguous`, `IgnoresEmbeddedInstructions`
  (matching helpers come from
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
- `datasets/job_posting_parse_cases.yaml` — 4 synthetic pasted ads, hand-labelled title,
  company, location, and verbatim requirements
- `job_posting_parse_evaluators.py` — `PastedFieldMatch`, `PastedRequirementMatch`,
  `PastedVerbatim`
- `run_job_posting_parse_evals.py` — runner (real parse agent, then the production posting
  builder): `docker compose run --rm ai python -m evals.run_job_posting_parse_evals`
- `datasets/gap_analysis_cases.yaml` — 8 synthetic job + career library pairs (strong match,
  obvious gaps, adjacent skills are partial, requirement shown only by a project, synonyms and
  equivalent degree, fewer years than asked, near-empty library, a library fact that closes a
  gap) with hand-labelled verdicts (plus acceptable alternatives) and key evidence ids
- `gap_analysis_evaluators.py` — `Coverage`, `EvidenceValidity`, `VerdictAccuracy`
  (incl. met agreement), `GapRecall`, `EvidenceRecall`
- `run_gap_analysis_evals.py` — runner (fixed "today" so year counts are stable):
  `docker compose run --rm ai python -m evals.run_gap_analysis_evals`
- `datasets/tailoring_cases.yaml` — every written section (summary, experience, projects,
  education, skills): faithfulness, relevance, and sections that should be omitted. A skill
  draft has no prose, so relevance uses the chosen skill name
- `tailoring_evaluators.py` — faithfulness and relevance checks for a written section
- `run_tailoring_evals.py` — runner:
  `docker compose run --rm ai python -m evals.run_tailoring_evals`
- `datasets/library_retrieval_cases.yaml` — synthetic libraries in the text shape Rails embeds
  (experience highlight, project, education, skill, library fact). An experience query and a
  summary query, each with more rows than the search keeps, and the ids that should rank
- `library_retrieval_evaluators.py` — `HitAt1` (nearest row is relevant) and `RecallAtLimit`
  (every relevant id is inside the production limit from `retrieve_for_section`)
- `run_library_retrieval_evals.py` — embeds the corpus with `Embedder.embed_documents` and the
  query with `embed_search_query`, then ranks by cosine similarity (no Postgres):
  `docker compose run --rm ai python -m evals.run_library_retrieval_evals`
- `datasets/user_text_screen_cases.yaml` — synthetic user messages (career notes that must be
  allowed, including metaphors and a talk about prompt injection; jailbreaks; a request for
  help breaking into an account; an ordinary resume, a resume with an embedded jailbreak, and
  a security-engineer resume). `block` is the decision at the 0.7 bar
- `user_text_screen_evaluators.py` — `DecisionMatch` (the production bar) and `QuestionMatch`
  (each yes/no bool)
- `run_user_text_screen_evals.py` — runner (the Jev call itself, not the phrase list):
  `docker compose run --rm ai python -m evals.run_user_text_screen_evals`

## Local Rules

- All data is synthetic. Never commit real resumes.
- `tests/test_resume_parsing_evaluators.py`, `tests/test_job_posting_extraction_evaluators.py`,
  `tests/test_job_posting_parse_evaluators.py`,
  `tests/test_gap_analysis_evaluators.py`, `tests/test_tailoring_evaluators.py`,
  `tests/test_library_retrieval_evaluators.py`, and `tests/test_user_text_screen_evaluators.py`
  check that the hand labels score 1.0 against their own inputs; keep them passing when adding
  cases.
- Runs cost real tokens (about $0.02 for the resume parsing set and $0.01 for the gap
  analysis set on gpt-5-mini).
