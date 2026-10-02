# AGENTS.md — services/ai/agents

## Purpose

Pydantic AI agents, one per file. Each has a Pydantic `output_type` from `schemas/` and its
instructions from `prompts/`.

## Contents

- `resume_parsing_agent.py` — resume text -> `ParsedResume`;
  `parse_resume_text(text, model, timeout_seconds)`
  returns a `ResumeParsingRun` (`parsed_resume`, `usage`)

## Local Rules

- Create agents with `defer_model_check=True` and pass the model per run (from
  `WorkerSettings`), so importing an agent never needs an API key and tests can override it
  with `agent.override(model=TestModel())`.
- Expose one plain function per agent that handlers and eval runners call. It runs the agent
  under an overall deadline (`WorkerSettings.llm_run_timeout_seconds`, below the `ai_tasks`
  visibility timeout) and raises `TimeoutError`, which the worker treats as retryable. It returns the
  output together with the run's `RunUsage`, so handlers can report cost.
- Every agent has an eval dataset and runner in `evals/`.
