# AGENTS.md — services/ai/prompts

## Purpose

Agent instructions, one constant per file. The module docstring lists the agent's input and
output in addition to the usual Description/Index.

## Contents

- `resume_parsing_instructions.py` — `RESUME_PARSING_INSTRUCTIONS` (extract only, copy bullets
  word for word, partial dates, warnings for ambiguity and for entries the resume doesn't
  clearly label)
- `job_requirements_sorting_instructions.py` — `JOB_REQUIREMENTS_SORTING_INSTRUCTIONS`
  (requirements vs nice-to-haves by bullet number; leave out responsibilities, benefits, and
  company info)
- `gap_analysis_instructions.py` — `GAP_ANALYSIS_INSTRUCTIONS` (the library is the only
  evidence; met / partial / missing; years from dated roles; adjacent experience is partial,
  never missing; cite labels, preferring highlights; summary addresses the user as "you")

## Local Rules

- Rerun the agent's evals after any prompt change.
