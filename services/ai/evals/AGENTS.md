# AGENTS.md — services/ai/evals

## Purpose

Pydantic Evals datasets, evaluators, and runners that measure agent quality against the real
model. Each run is one Logfire trace (agent calls nested inside) with the average of every
score attached, so runs can be compared across prompt and model changes.

## Contents

- `run_report.py` — optional report CLI for every suite; one model or aligned two-model comparison.
  Prints results by default; `--save` writes to docs/evals, and `--output-dir` saves elsewhere.
  Save reports only when the user requests them;
  routine validation uses standalone runners and terminal output.
- `report_capture.py` — isolated native report capture and eval-only model settings copies.
- `report_markdown.py` — readable aggregates, aligned outputs/reasons and failure artifacts.
- `report_costs.py` — report-scoped per-request usage capture and local price estimates.
- `report_cost_markdown.py` — per-model token costs, coverage and aligned comparisons.

- `telemetry.py` — shared all-suite evaluation/report lifecycle, native Logfire eval
  context, always-flushed runs and numeric aggregate scores. Capture completed reports before
  aggregation or printing; preserve suite failure policies and native report objects.
  Specialized suites supply setup before the run span, custom score emission inside it,
  and their existing print options. Guardrail emits decision/error scores only.

- `run_prompt_guardrail_evals.py` / `datasets/prompt_guardrail_cases.yaml` — live Jev through
  the official InputGuardrail capability, with a fake generative model. Measures allow/block
  decisions on assembled prompts and the parsing dataset's `expects_input_block` cases.
  Outages fail evaluation rather than scoring as successful attack detection.
  Run `docker compose run --rm ai python -m evals.run_prompt_guardrail_evals`.
- Parsing quality runs exclude expected input blocks; the fixtures remain for deterministic
  evaluator tests and the dedicated capability suite. No production screening bypass exists.
- `datasets/resume_parsing_cases.yaml` — 8 synthetic, hand-labelled resumes (clean, year-only
  dates, messy two-column extraction, ambiguous entries, not a resume, an embedded instruction,
  and a longer promotion history with projects and credentials)
- `resume_parsing_evaluators.py` — deterministic evaluators: `SourceFaithfulness`,
  `ExperienceMatch` (one-to-one roles and their own verbatim bullet recall), `SectionRecall`, `WarnsWhenAmbiguous`, `IgnoresEmbeddedInstructions`
  (matching helpers come from
  `documents/text_matching.py`, shared with the production faithfulness guard; evals score the
  raw agent output, before that guard runs)
- `run_resume_parsing_evals.py` — runner:
  `docker compose run --rm ai python -m evals.run_resume_parsing_evals`; prepares local
  contact masking before screening/parsing and restores raw structured outputs before
  evaluator scoring, without applying the source-faithfulness guard. Cases run sequentially by
  default so latency comparisons do not compete across resumes; parser groups still overlap
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
- `datasets/job_posting_parse_cases.yaml` — 5 synthetic pasted ads, including an unnamed employer, hand-labelled title,
  company, location, and verbatim requirements
- `job_posting_parse_evaluators.py` — `PastedFieldMatch`, `PastedRequirementMatch`,
  `PastedVerbatim`
- `run_job_posting_parse_evals.py` — runner (real parse agent, then the production posting
  builder): `docker compose run --rm ai python -m evals.run_job_posting_parse_evals`
- `datasets/gap_analysis_cases.yaml` — 9 synthetic job + career library pairs (strong match,
  obvious gaps, adjacent skills are partial, requirement shown only by a project, synonyms and
  equivalent degree, fewer years than asked, near-empty library, a library fact that closes a
  gap) with hand-labelled verdicts (plus acceptable alternatives) and key evidence ids
- `gap_analysis_evaluators.py` — `Coverage`, `EvidenceValidity`, `VerdictAccuracy`
  (incl. met agreement), `GapRecall`, `EvidenceRecall`
- `run_gap_analysis_evals.py` — runner (fixed "today" so year counts are stable):
  `docker compose run --rm ai python -m evals.run_gap_analysis_evals`
- `datasets/resume_document_cases.yaml` / `run_tailoring_evals.py` — complete Markdown writer
  and independent editorial reviewer quality on synthetic libraries and jobs.
- `tailoring_evaluators.py` — whole-document quality evaluation; runtime generation has no
  automated section faithfulness validators or evidence labels.
- `library_retrieval_query.py` — stable synthetic focus queries and eight-result benchmark
  cutoff, independent of complete-library resume generation.
- `datasets/library_retrieval_cases.yaml` — synthetic libraries in the text shape Rails embeds
  (experience highlight, project, education, skill, library fact). An experience query and a
  summary query, each with more rows than the search keeps, and the ids that should rank
- `library_retrieval_evaluators.py` — `HitAt1`, `RecallAtK`, `PrecisionAtK`, and
  `MeanReciprocalRank` (k is the stable benchmark cutoff)
- `run_library_retrieval_evals.py` — embeds the corpus with `Embedder.embed_documents` and the
  query with `embed_search_query`, then ranks with `hybrid_order` (no Postgres):
  `docker compose run --rm ai python -m evals.run_library_retrieval_evals`
- `datasets/user_text_screen_cases.yaml` — synthetic user messages (career notes that must be
  allowed, including metaphors and a talk about prompt injection; jailbreaks; a request for
  help breaking into an account; an ordinary resume, a resume with an embedded jailbreak, and
  a security-engineer resume). `block` is the decision at the 0.7 bar
- `user_text_screen_evaluators.py` — `DecisionMatch` (the production bar) and `QuestionMatch`
  (each yes/no bool)
- `run_user_text_screen_evals.py` — runner (the Jev call itself, not the phrase list):
  `docker compose run --rm ai python -m evals.run_user_text_screen_evals`
- `run_user_text_fallback_evals.py` — dedicated Nano boolean classifier quality run on the
  shared synthetic screening cases. Uses production boolean policy, never JEV margins.
  Outages are errors and wrong decisions fail the runner. Run
  `docker compose run --rm ai python -m evals.run_user_text_fallback_evals`.
- `run_screen_chunk_comparison.py` — 14 synthetic ordinary, long, and security-career
  resumes, including attacks at the beginning/middle/end and across both candidate chunk
  grids. Compares the production 2,000/4,000-character screens with 300-character overlap
  against a whole-document baseline; phrase checks are disabled for every configuration.
  Runs sequentially with fresh sessions and restores its temporary setting/request observer.
  Reports per-document decisions, errors, latency, actual provider attempts, and recorded
  token/cost usage. Outages never count as detected attacks. Saves all evidence before a
  nonzero CLI exit on errors or wrong decisions, without choosing a winning configuration:
  `docker compose run --rm ai python -m evals.run_screen_chunk_comparison --output /app/chunk-comparison.json`.

## Local Rules

- `datasets/interview_questions_cases.yaml` / `datasets/interview_feedback_cases.yaml` —
  fifteen question cases and seventeen feedback cases for general/technical/knowledge full sets and replacements,
  software and nonsoftware practical work, sparse education, complete/incomplete stories, no matching example,
  uncertain/negative outcomes, introductions, and legacy goals/development questions.
  Knowledge cases cover Python, nontechnology food safety, sparse historical source comparison,
  distinct replacement intents, incorrect answer correction, and accurate but incomplete answers.
  The knowledge accuracy judge checks corrections; scope-aware example grounding permits subject facts while forbidding invented experience.
- `interview_evaluators.py` — deterministic structure, evidence, and placeholder checks.
- `interview_eval_reporting.py` — input-aware Pydantic Evals judging and Logfire scores;
  `interview_judge.py` submits all applicable rubrics in one attempt with independent
  `EVAL_JUDGE_MODEL` configuration. Output and HTTP retries are disabled; case errors
  make the runner fail. Knowledge accuracy is omitted for general/technical inputs,
  so its aggregate is knowledge-only. Instructions live in the prompts package.
  Reports include raw output JSON so bracket placeholders can be checked without terminal
  markup. Feedback placeholder expectations live in metadata, outside agent/judge inputs;
  failed feedback runs print their validation retry reasons.
- `run_interview_questions_evals.py` / `run_interview_feedback_evals.py` — run after changes
  to either interview prompt, model, or agent:
  `docker compose run --rm ai python -m evals.run_interview_questions_evals` and
  `docker compose run --rm ai python -m evals.run_interview_feedback_evals`.
  These exercise agents on trusted synthetic inputs; worker screening/failure behavior is
  covered separately by handler tests. Subjective scores are review signals, not pass gates.
- `tests/test_interview_evaluators.py` verifies structural passes and deliberate failures
  without provider calls.

- All data is synthetic. Never commit real resumes.
- `tests/test_resume_parsing_evaluators.py`, `tests/test_job_posting_extraction_evaluators.py`,
  `tests/test_job_posting_parse_evaluators.py`,
  `tests/test_gap_analysis_evaluators.py`,
  `tests/test_library_retrieval_evaluators.py`, and `tests/test_user_text_screen_evaluators.py`
  check that the hand labels score 1.0 against their own inputs; keep them passing when adding
  cases.
- Runs cost real tokens. The October 2026 Luna-only rerun estimated about $0.0013 for
  resume parsing and $0.0019 for gap analysis, including screening. Costs vary with usage.

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.
