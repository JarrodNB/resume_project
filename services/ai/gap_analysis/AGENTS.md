# AGENTS.md — services/ai/gap_analysis

## Purpose

Deterministic code around the gap analysis agent: turn the job and career library into a
labeled prompt, check the agent's output, and copy evidence text back from the library so it
can't be invented.

## Contents

- `prepare_gap_analysis.py` — `prepare_gap_analysis(context, today, screen_model,
  timeout_seconds)` returns a prepared prompt and completed screening usage, or a failure
  retaining that usage. It projects requirements and nice-to-haves, serializes the complete
  library as one source, checks the 80,000-character source and 120,000-character prompt caps
  before paid calls, then screens unchecked readable job and library fields together in one
  `screen_records` call (one classifier call on a fresh library unless the text needs splitting).
  Saved Job and library fields reuse checks across tasks; new checks become `record_screening` receipts.
  Both are required: rejection or an incomplete screen stops analysis. It reconstructs and
  binds the exact prompt from approved source snapshots; direct unknown prompts remain guarded.
- `build_gap_analysis_prompt.py` — `build_gap_analysis_prompt(context, today)` labels the
  complete supplied context and returns text, lookups, and warnings. Labels: `R1`/`N1` for
  requirements and nice-to-haves; `E1` experience, `H1` highlight, `P1` project, `ED1`
  education, `C1` certification, `S1` skill, `F1` library fact. The profile summary is
  unlabeled background, not evidence. Production callers use preparation before generation.
- `find_gap_analysis_problems.py` — `find_gap_analysis_problems(analysis, prompt)`: missing,
  repeated, or unknown requirement labels, unknown evidence labels, met/partial without
  evidence, and labels written into the explanations or summary (the user never sees labels;
  label-like words that are real job or library text, e.g. "S3", are allowed); the agent's
  output validator sends these back as a retry
- `attach_evidence_text.py` — `attach_evidence_text(analysis, prompt)`: maps labels to ids and
  library text, in posting order, deduped; returns the `GapAnalysisResult` sent to Rails

## Local Rules

- The LLM only ever sees and returns labels; ids and evidence text come from code.
- Preparation delegates screening to the shared `screening/` policy; direct LLM calls live
  in `agents/`. Prompt formatting and evidence attachment stay deterministic.

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.

Credential dates retain `year`, `month`, or `day` precision. Exact expiration within a partial expiry period is unknown; after the period it is
definitely expired. `schemas/certification_dates.py` centralizes
formatting and expiry boundaries; tailoring prompts accept an injectable `today`.
