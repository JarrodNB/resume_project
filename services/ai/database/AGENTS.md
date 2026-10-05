# AGENTS.md — services/ai/database

## Purpose

Read-only Postgres access with the `ai_reader` role. Rails owns the schema and every write;
this folder only reads what an AI task needs.

## Contents

- `open_read_only_connection.py` — `open_read_only_connection(settings)`: psycopg connection
  with `default_transaction_read_only=on` and dict rows
- `career_library_reader.py` — `read_gap_analysis_context(connection, user_id, job_id)`: the job
  and the user's career library in one REPEATABLE READ transaction (None when the job isn't the
  user's); `build_database_context_reader(settings)`: the per-task reader handlers call (one
  connection per task)
- `library_embedding_search.py` — `search_career_library(connection, user_id, query_embedding,
  model, limit)`: the user's `library_embeddings` rows for `model` nearest the query by cosine
  distance (`LibrarySearchMatch` list), using HNSW iterative scans so the user filter doesn't
  cut results short. Registers the pgvector type on the connection. Not called by a handler yet
  (tailoring will)

## Local Rules

- All SQL lives here. Every query filters by the task message's `user_id` (child rows through
  their parent's `user_id`).
- `ai_reader` can only read the tables granted in Rails `lib/ai_reader_access.rb` (of `users`,
  only `id` and `summary`). Add a grant there before reading a new table.
- Keep list order the same as the Rails career library (most recent first; skills by position).
- Connection errors (`psycopg.OperationalError`) are retryable; SQS redelivers the task.
