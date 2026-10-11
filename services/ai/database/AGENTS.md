# AGENTS.md — services/ai/database

## Purpose

Read-only Postgres access with the `ai_reader` role. Rails owns the schema and every write;
this folder only reads what an AI task needs.

## Contents

- `open_read_only_connection.py` — `open_read_only_connection(settings)`: psycopg connection
  with `default_transaction_read_only=on` and dict rows
- `career_library_reader.py` — `read_gap_analysis_context(connection, user_id, job_id)`: the job
  and the user's career library, including certifications and library facts, in one REPEATABLE READ transaction
  (None when the job isn't the user's). Job-only gap responses are not read.
  `build_database_context_reader(settings)`: the per-task reader handlers call (one
  connection per task)
- `library_embedding_search.py` — `search_career_library(connection, user_id, query_embedding,
  query_text, model, limit)`: the user's `library_embeddings` rows for `model`, ordered by
  hybrid rank (`LibrarySearchMatch` list). Cosine order uses HNSW iterative scans so the user
  filter doesn't drop a row before BM25 sees it. Registers the pgvector type on the connection.
  Tailoring calls it once per written section
- `profile_contact.py` — `read_profile_contact(connection, user_id)`: `name`, `contact_email`,
  and `phone` for masking outbound text

## Local Rules

- All SQL lives here. Every query filters by the task message's `user_id` (child rows through
  their parent's `user_id`).
- `ai_reader` can only read the tables granted in Rails `lib/ai_reader_access.rb` (of `users`,
  `id`, `summary`, `name`, `contact_email`, and `phone`). Add a grant there before reading a
  new column.
- Keep list order the same as the Rails career library (most recent first; skills by position).
- Connection errors (`psycopg.OperationalError`) are retryable; SQS redelivers the task.

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.

Credential dates retain `year`, `month`, or `day` precision. Exact expiration within a partial expiry period is unknown; after the period it is
definitely expired. `schemas/certification_dates.py` centralizes
formatting and expiry boundaries; tailoring prompts accept an injectable `today`.

- `career_library_reader.py` also exposes `read_career_library` / `build_database_library_reader` for job-independent, user-scoped snapshots; gap analysis shares the same row reader.
