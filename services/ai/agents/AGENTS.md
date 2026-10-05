# AGENTS.md — services/ai/agents

## Purpose

Pydantic AI agents, one per file. Each has a Pydantic `output_type` from `schemas/` and its
instructions from `prompts/`.

## Contents

- `resume_parsing_agent.py` — resume text -> `ParsedResume`;
  `parse_resume_text(text, model, thinking, timeout_seconds)`
  returns a `ResumeParsingRun` (`parsed_resume`, `usage`)
- `job_requirements_sorting_agent.py` — numbered job posting bullets ->
  `SortedRequirementBullets` (bullet numbers only, so wording can't change);
  `sort_job_requirement_bullets(bullets, model, thinking, timeout_seconds)` returns a
  `BulletSortingRun` (`sorted_bullets`, `usage`). Only runs when a posting's headings don't
  label its requirements
- `gap_analysis_agent.py` — labeled job requirements + career library -> `GapAnalysis` (a
  verdict per requirement citing library labels); its output validator retries with
  `find_gap_analysis_problems` messages; `analyze_gaps(prompt, model, thinking, timeout_seconds)`
  returns a `GapAnalysisRun` (`gap_analysis`, `usage`)
- `user_text_screen_agent.py` — user-written text -> `UserTextScreen` (two bool questions on
  `typesafe:jev-latest`); `screen_user_message` returns the screen, model name, confidence, and
  usage. No generative fallback
- `resume_tailoring_agent.py` — one written section -> `TailoredSectionDraft`; its output
  validator retries with `find_section_problems`; `write_resume_section` returns the draft and
  usage. It writes prose and must not invent employers, titles, tools, dates, metrics, or
  responsibilities

## Local Rules

- Create agents with `defer_model_check=True` and pass the model per run (from
  `WorkerSettings`), so importing an agent never needs an API key and tests can override it
  with `agent.override(model=TestModel())`.
- Expose one plain function per agent that handlers and eval runners call. It runs the agent
  under an overall deadline (`WorkerSettings.llm_run_timeout_seconds`, below the `ai_tasks`
  visibility timeout) and raises `TimeoutError`, which the worker treats as retryable. It returns the
  output together with the run's `RunUsage`, so handlers can report cost.
- Every agent has an eval dataset and runner in `evals/`.
