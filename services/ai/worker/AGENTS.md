# AGENTS.md — services/ai/worker

## Purpose

The worker process: polls SQS, dispatches each task to the right handler, publishes results.

## Contents

- `main.py` — entry point and polling loop (`python -m worker.main`); `process_task_message`
  wraps each task in a Langfuse trace and publishes the result before the task message may be
  deleted
- `queue_messages.py` — Pydantic models for `ai_tasks` and `ai_results` messages (keep them in
  sync with `AiTasks::EnqueueAiTaskService` and `AiTasks::ApplyAiResultService` in Rails)
- `task_handlers.py` — `handle_ai_task`: dispatches by `task_type` (`TASK_HANDLERS`); types
  without a handler yet return a "not supported yet" failure
- `parse_resume_handler.py` — downloads the upload, extracts text, runs the resume parsing agent
- `task_dependencies.py` — `TaskDependencies` (settings + file storage) passed to every handler
- `s3_file_storage.py` — read-only download from the uploads bucket (S3Mock locally)
- `tracing.py` — `configure_tracing` (Langfuse + `Agent.instrument_all()`), `trace_ai_task`
- `settings.py` — environment-based configuration (`WorkerSettings`, incl. model names)
- `sqs_queue_client.py` — wrapper for one SQS queue (receive, delete, send)

## Local Rules

- Keep this package about queue plumbing and dispatch. Agent logic goes in `agents/`,
  tools in `tools/`, prompts in `prompts/` (sibling folders).
- Handlers take `(task, dependencies)` and return an `AiResultMessage`. Return a `failed`
  result with a user-facing `error_message` for expected problems (e.g. unreadable file);
  let unexpected exceptions propagate (main publishes a generic failure).
