# AGENTS.md — services/ai/worker

## Purpose

The worker process: polls SQS, dispatches each task to the right handler, publishes results.

## Contents

- `main.py` — entry point and polling loop (`python -m worker.main`); `process_task_message`
  wraps each task in a Langfuse trace and publishes the result before the task message may be
  deleted; `poll_until_stopped` logs and retries errors (5s pause) instead of exiting
- `queue_messages.py` — Pydantic models for `ai_tasks` and `ai_results` messages (keep them in
  sync with `AiTasks::EnqueueAiTaskService` and `AiTasks::ApplyAiResultService` in Rails)
- `task_handlers.py` — `handle_ai_task`: dispatches by `task_type` (`TASK_HANDLERS`); types
  without a handler yet return a "not supported yet" failure
- `parse_resume_handler.py` — downloads the upload, extracts text, runs the resume parsing
  agent, checks its output with `enforce_source_faithfulness`, reports its token usage
- `scrape_job_handler.py` — picks the site's scraper for the URL, extracts the posting (sorting
  agent only when headings don't label requirements), reports usage only if the agent ran;
  unsupported URLs and missing postings fail with user-facing messages
- `analyze_gaps_handler.py` — reads the job and career library (scoped to the task's user),
  screens each library fact, builds the labeled prompt, runs the gap analysis agent, attaches
  evidence text, and reports Jev usage; a deleted job, empty library, or job without
  requirements fails with a user-facing message
- `tailor_resume_handler.py` — writes one resume section per message (contact is copied, then
  summary, experience, projects, education, skills), pauses for approval, and echoes `generation`.
  A section with no library entries is left out with no model call. Projects, education, and
  skills are not narrowed by retrieval
- `tailor_resume_steps.py` — folds the user's decision, screens gap responses, and builds the
  pause or failure result
- `model_prices.py` — USD per 1M tokens per model (`MODEL_PRICES`), `estimate_cost_microdollars`,
  `build_model_usage`; Rails sums the costs to enforce each user's monthly AI budget
- `retryable_errors.py` — `is_retryable_error`: temporary failures (rate limits, 5xx, network,
  incl. job site fetches through httpx and database connection errors) are left for SQS to redeliver; anything else, or the
  last attempt, publishes `failed`
- `product_name.py` — `PRODUCT_NAME` and the job-scraper `USER_AGENT` built from it
- `task_dependencies.py` — `TaskDependencies` (settings + file storage + `httpx.Client` for job
  sites + gap analysis context reader) passed to every handler; `build_http_client`
- `s3_file_storage.py` — read-only download from the uploads bucket (S3Mock locally)
- `tracing.py` — `configure_tracing` (Langfuse + `Agent.instrument_all()` +
  `Embedder.instrument_all()` + the contact mask on every agent), `trace_ai_task`
- `known_contact.py` — `KnownContact`: the user's known name, contact email, and phone mapped
  to «name», «email», and «phone»
- `contact_mask.py` — applies that map on the model request, the Langfuse payload, and
  `mask_outbound` (search-query embeddings). The model response is restored before the app
  sees it
- `settings.py` — environment-based configuration (`WorkerSettings`, incl. model names, the
  embedding model and dimensions (must match Rails' `CareerLibraryEmbeddings`), the
  read-only database connection (`DB_*`), and `llm_run_timeout_seconds`, which must stay below the `ai_tasks` visibility timeout)
- `sqs_queue_client.py` — wrapper for one SQS queue (receive, delete, send)

## Local Rules

- Keep this package about queue plumbing and dispatch. Agent logic goes in `agents/`,
  tools in `tools/`, prompts in `prompts/` (sibling folders).
- Handlers take `(task, dependencies)` and return an `AiResultMessage`. Return a `failed`
  result with a user-facing `error_message` for expected problems (e.g. unreadable file);
  let unexpected exceptions propagate (main publishes a generic failure).
- Completed results list a `ModelUsage` for every agent run (`build_model_usage(model, usage)`).
  A new model needs an entry in `MODEL_PRICES` (a test checks every configured model has one).
