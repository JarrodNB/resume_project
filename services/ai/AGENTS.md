# AGENTS.md — services/ai

## Purpose

All LLM work: resume parsing, job URL scraping into structured profiles, gap analysis,
resume tailoring, and long-term user memory. Traced in Langfuse.

## Stack

Python SQS workers (no web framework; ElasticMQ locally), boto3, Pydantic, Pydantic AI
(agents, tools, structured outputs) on OpenAI models, Pydantic Evals, Langfuse, pgvector for memory
retrieval. Kubernetes health checks use exec probes instead of HTTP endpoints.

## Local Rules

- Workers consume task messages from SQS and publish results to the `ai_results` queue.
  The database connection uses the read-only `ai_reader` role (for memory retrieval); never
  attempt writes.
- Receive one message at a time, and delete it only after its result is published. Task
  handlers must be safe to run twice, because SQS can redeliver.
- **All LLM work uses Pydantic AI agents.** Never call the OpenAI SDK directly.
  - One agent per file (`agents/gap_analysis_agent.py`), with a Pydantic model as its `output_type`.
  - Tools live in their own files (`tools/`) and are registered on the agents that need them.
  - Workers inject per-task context (user ID, retrieved memories) through the agent's `deps`.
- Instructions/system prompts live in their own files (`prompts/`), one per file, with a header describing inputs/outputs.
- Use Pydantic models for every queue message and every structured LLM output.
- **Langfuse tracing** comes from Pydantic AI's OpenTelemetry instrumentation
  (`Agent.instrument_all()` at worker startup). Tag traces with the user ID and task ID,
  and flush at the end of each task. Langfuse Cloud (free tier) is used in all environments
  for now; its API keys go in `services/ai/.env` (copied from `.env.example`, never committed).
- **Human-in-the-loop uses Pydantic AI deferred tools.** When an agent needs information
  from the user, it calls an external `ask_user` tool and the run ends with
  `DeferredToolRequests`. The worker publishes a `needs_user_input` result containing the
  question(s) and the serialized message history. When the user answers, the follow-up task
  resumes with that history plus `DeferredToolResults`.
- **Every agent has evals** in `evals/`, written with Pydantic Evals:
  - One dataset file per agent (`evals/datasets/tailoring_cases.yaml`) and one runner per
    agent (`evals/run_tailoring_evals.py`).
  - Use deterministic evaluators where possible; use LLM-as-judge only for subjective
    checks (relevance, question quality, faithfulness).
  - Test data is synthetic or anonymized. Never commit real user resumes.
  - Report results to Langfuse. Run evals after any prompt, model, or agent change:
    `docker compose run --rm ai python -m evals.run_tailoring_evals`.

## File Header Format

Every Python file starts with a module docstring:

```python
"""
Description: Compares resume content to a job profile and returns matches and gaps.
Index:
    - analyze_resume_against_job: main entry point
    - extract_requirement_gaps: lists requirements with no supporting evidence
"""
```

Every function and class gets a docstring describing what it does.

## Contents

- `worker/` — polling loop, settings, SQS client (see `worker/AGENTS.md`)
- `pyproject.toml` / `uv.lock` — dependencies, managed with `uv`
  (add one with `docker compose run --rm ai uv add <package>`, then rebuild)
- `Dockerfile.dev` — local dev image (virtualenv at `/opt/venv`)
- `.env.example` — secrets template
