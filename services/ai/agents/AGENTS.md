# AGENTS.md — services/ai/agents

## Purpose

Pydantic AI agents, one per file. Each has a Pydantic `output_type` from `schemas/` and its
instructions from `prompts/`.

## Contents

- `resume_parsing_agent.py` — resume text -> `ParsedResume`;
  `format_resume_user_prompt` fences the file as data and neutralizes a resume tag even
  when it contains a space or a newline;
  `parse_resume_text(text, model, thinking, timeout_seconds)`
  returns a `ResumeParsingRun` (`parsed_resume`, `usage`)
- `parse_job_posting_agent.py` — pasted job ad -> `ParsedJobPosting` (title, company, optional
  location and url, requirement, responsibility, and nice-to-have lines copied from the ad);
  its output validator retries with
  `find_parsed_job_problems`; `parse_job_posting(text, model, thinking, timeout_seconds)` returns
  a `JobPostingParseRun` (`parsed`, `usage`)
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
  `typesafe:jev-1.13.0`); `screen_user_message` returns the screen, model name, confidence, and
  usage. No generative fallback
- `resume_tailoring_agent.py` — one written section -> `TailoredSectionDraft`; its output
  validator retries with `find_section_problems`; `write_resume_section` returns the draft and
  usage. It writes prose and must not invent employers, titles, tools, dates, metrics, or
  responsibilities

## Local Rules

- Every generative agent declares `capabilities=[InputGuardrail(guard=screen_prompt)]` in its
  constructor. The official Harness input guard checks complete assembled context before
  generation. Keep existing structured-output validators. Jev is exempt to prevent recursion.
- Create agents with `defer_model_check=True` and pass the model per run (from
  `WorkerSettings`), so importing an agent never needs an API key and tests can override it
  with `agent.override(model=TestModel())`.
- Expose one plain function per agent that handlers and eval runners call. It runs the agent
  under an overall deadline (`WorkerSettings.llm_run_timeout_seconds`, below the `ai_tasks`
  visibility timeout) and raises `TimeoutError`, which the worker treats as retryable. It also
  passes `agent_usage_limits` (request, tool-call, and token caps). `UsageLimitExceeded` fails
  the task on the first attempt. It returns the
  output together with the run's `RunUsage` and the model name to bill, so handlers can report
  cost for the model that answered.
- Generative runs take `fallback_model` and call `generative_model` (primary, then
  `gpt-5-nano` on a provider error). The Jev screen does not.
- Each run stamps its prompt version with `record_prompt_version`.
- Every agent has an eval dataset and runner in `evals/`.

- `interview_questions_agent.py` — bounded general/technical/knowledge generation/replacement with category scope,
  count, label-leakage, duplicate, and evidence ID validation; resolves IDs to original excerpts; quality checks run in `evals/run_interview_questions_evals.py`.

- `interview_feedback_agent.py` — bounded structured coaching and illustrative examples.
  Runtime validation checks nonblank output and at most two placeholders, then normalizes exact evidence excerpts, dropping
  invalid optional quotes without failing feedback. Examples allow natural paraphrasing;
  personal-fact grounding is instructed in the prompt and assessed in quality evals.
  Knowledge feedback permits subject corrections from model knowledge while forbidding invented personal experience.
  Trusted dependency scope selects a separate knowledge instruction file, so personal-fact-only scaffold rules never reach knowledge provider requests.
  Knowledge examples retry when they exceed 120 words; output schema descriptions distinguish subject corrections from personal-fact examples.
  Quality checks run in `evals/run_interview_feedback_evals.py`.
