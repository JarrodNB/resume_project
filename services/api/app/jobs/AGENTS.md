# AGENTS.md — services/api/app/jobs

## Purpose

Active Job background jobs for work that must not block a request (AI tasks go over SQS
instead; see `app/workers/`). Development and production use Solid Queue on the
primary application connection; most tests use the test adapter. Both runtimes need
the dedicated jobs process. See `docs/architecture/background-jobs.md` from the root.

## Contents

- `ai_executions/` — transactional dispatch and exact-lease recovery jobs, plus
  bounded framework-failure reconciliation. HTTP202 alone never completes delivery;
  stale delivery/watchdog identities cannot stop a newer execution cycle.

- `interview_prep/` — question-specific saved Q&A vector jobs; after-commit enqueue, temporary provider retries, missing-key skip, no AI-task accounting.

- `application_job.rb` — generated base class
- `account_mail_delivery_job.rb` — Devise mail via Rails/Solid Queue; private arguments,
  sanitized SMTP errors, at most three attempts. Runs through `bin/jobs`.
- `career_library/sync_library_embeddings_job.rb` — `perform(user_id)` runs
  `CareerLibrary::SyncLibraryEmbeddingsService`; enqueued only after the surrounding transaction
  commits (`enqueue_after_transaction_commit`), retries OpenAI connection errors, timeouts, 429s,
  and 5xx, and is skipped when `OPENAI_API_KEY` isn't set or the user is gone

## Local Rules

- Jobs stay thin: look up records, call a service.
- Jobs must be safe to run twice (retries and duplicate enqueues happen).
- Transactional domain-delivery jobs explicitly disable after-commit enqueue and
  enqueue inside the domain transaction. Never add a separate Solid Queue pool;
  legacy embedding/mail jobs retain their explicit after-commit behavior.
