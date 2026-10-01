# AGENTS.md — services/ai/worker

## Purpose

The worker process: polls SQS, dispatches each task to the right handler, publishes results.

## Contents

- `main.py` — entry point and polling loop (`python -m worker.main`); `process_task_message`
  publishes the result before the task message may be deleted
- `queue_messages.py` — Pydantic models for `ai_tasks` and `ai_results` messages (keep them in
  sync with `AiTasks::EnqueueAiTaskService` and `AiTasks::ApplyAiResultService` in Rails)
- `task_handlers.py` — `handle_ai_task`: echoes the input until agents are added
- `settings.py` — environment-based configuration (`WorkerSettings`)
- `sqs_queue_client.py` — wrapper for one SQS queue (receive, delete, send)

## Local Rules

- Keep this package about queue plumbing and dispatch. Agent logic goes in `agents/`,
  tools in `tools/`, prompts in `prompts/` (sibling folders, created when first needed).
