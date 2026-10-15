# AGENTS.md — services/api/app/jobs

## Purpose

Active Job background jobs for work that must not block a request (AI tasks go over SQS
instead; see `app/workers/`). Development uses the in-process async adapter, tests the test
adapter, and production Solid Queue (it needs a jobs process at deploy time).

## Contents

- `interview_prep/` — question-specific saved Q&A vector jobs; after-commit enqueue, temporary provider retries, missing-key skip, no AI-task accounting.

- `application_job.rb` — generated base class
- `career_library/sync_library_embeddings_job.rb` — `perform(user_id)` runs
  `CareerLibrary::SyncLibraryEmbeddingsService`; enqueued only after the surrounding transaction
  commits (`enqueue_after_transaction_commit`), retries OpenAI connection errors, timeouts, 429s,
  and 5xx, and is skipped when `OPENAI_API_KEY` isn't set or the user is gone

## Local Rules

- Jobs stay thin: look up records, call a service.
- Jobs must be safe to run twice (retries and duplicate enqueues happen).
