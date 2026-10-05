# AGENTS.md — services/ai/gap_analysis

## Purpose

Deterministic code around the gap analysis agent: turn the job and career library into a
labeled prompt, check the agent's output, and copy evidence text back from the library so it
can't be invented.

## Contents

- `build_gap_analysis_prompt.py` — `build_gap_analysis_prompt(context, today)` returns a
  `GapAnalysisPrompt` (prompt text + label lookups). Labels: `R1`/`N1` for requirements and
  nice-to-haves;   `SUMMARY`, `E1` experience, `H1` highlight, `P1` project, `ED1` education,
  `S1` skill, `F1` library fact; `format_date_range`
- `find_gap_analysis_problems.py` — `find_gap_analysis_problems(analysis, prompt)`: missing,
  repeated, or unknown requirement labels, unknown evidence labels, met/partial without
  evidence, and labels written into the explanations or summary (the user never sees labels;
  label-like words that are real job or library text, e.g. "S3", are allowed); the agent's
  output validator sends these back as a retry
- `attach_evidence_text.py` — `attach_evidence_text(analysis, prompt)`: maps labels to ids and
  library text, in posting order, deduped; returns the `GapAnalysisResult` sent to Rails

## Local Rules

- The LLM only ever sees and returns labels; ids and evidence text come from code.
- No LLM calls here (they live in `agents/`).
