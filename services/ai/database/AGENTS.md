# AGENTS.md — services/ai/database

## Purpose

Read-only Postgres access with the `ai_reader` role. Rails owns the schema and every write;
this folder only reads what an AI task needs.

## Contents

- `job_preferences.py` — reads an owned queued preference command, its current confirmed
  profile and selected catalogue sources in one repeatable read. Revision/fingerprint changes
  fail closed; exact generated provenance comes from `ai_generated_preference_criteria`,
  while profile drafts and unrelated task results remain unreadable.

- `job_listing_reranking.py` — verifies an owned queued command before reading selected
  shared public catalogue IDs/payloads. Catalogue rows have no private owner; selection
  and every career-library read remain owner-scoped.
- `task_commands.py` — loads only the ID/owner/type-matched queued task input.
  Rails grants only task identity, status and input columns. The separate library exchange
  view exposes generated outputs/history only for the two library workflows.
- `open_read_only_connection.py` — `open_read_only_connection(settings)`: psycopg connection
  with `default_transaction_read_only=on` and dict rows
- `career_library_reader.py` — `read_gap_analysis_context(connection, user_id, job_id)`: the job
  and the user's career library, including certifications and career context entries, in one REPEATABLE READ transaction
  (None when the job isn't the user's). Job-only gap responses are read separately by tailoring.
  `build_database_context_reader(settings)`: the per-task reader handlers call (one
  connection per task)
- `library_embedding_search.py` — `search_career_library(connection, user_id, query_embedding,
  query_text, model, limit, *, source_types)`: requires a nonempty set of supported source
  types, filtered in SQL alongside user/model before either ranking. Returns rows ordered by
  hybrid rank (`LibrarySearchMatch` list). Accepts configured or stored embedding-model names
  and owns conversion to Rails' stored model representation. Cosine order uses HNSW iterative scans so the user
  filter doesn't drop a row before BM25 sees it. Registers the pgvector type on the connection.
  Tailoring calls it for summary/experience with an explicit mixed-type selection
- `profile_contact.py` — `read_profile_contact(connection, user_id)`: `name`, `contact_email`,
  and `phone` for masking outbound text

## Local Rules

- All SQL lives here. Private queries filter by the task message's `user_id` (child rows through
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

- `library_review_reader.py` reads only the requested owned section and its owned highlights,
  computing labels/context digests in one read transaction. Digests match Rails admission,
  including dates, nulls and HTML escaping. No source data is persisted in review commands.

- `career_library_reader.py` also exposes `read_career_library` / `build_database_library_reader` for job-independent, user-scoped reads; gap analysis shares the same row reader.

- `job_listing_similarity.py` — one read-only lateral query averages each listing vector’s
  three nearest library similarities, scoped by task user and configured model. Its
  production builder bounds connection/statement deadlines; it never reads the catalogue.

- `summary_sources.py` — current owned profile/resume evidence with exact reference hashes; resume prose trust reads only the narrow `ai_accepted_resume_prose` view. No sources are stored in commands.
- `tailoring_sources.py` reads current owned job/library/contact and job gap responses in one
  repeatable-read transaction. A queued task/owner/job projection fences the command subject. Optional comparison IDs must match the owner and job in
  `completed_gap_analysis_sources`, a nonmaterialized completed-analysis-only projection.
  Gap responses expose only identity, requirement/body, checks and ordering columns.
  Profile location/links are readable for the copied contact section; authentication fields stay private.
- `interview_inputs.py` — validates owner/operation/attempt/generation, live lease/deadline,
  saved mode/settings and session state. Preparation reads current owned job/library/preferences
  once; turns read prepared questions and accepted public dialogue, with profile contact only
  for masking. Speech loads its exact saved message. Private model history and media keys
  remain outside the reader grants. Rails owns every write and media capability.
- `library_edit_reader.py` loads one owned target/context and its bounded root/previous chain,
  reads generated review questions from the completed owned review, and validates context digests.
  `ai_library_exchanges` is a read-only security-barrier view restricted to library review/edit
  task types and necessary identity/input/output/history fields; accounting and other task results
  remain hidden. Child commands never copy model history or root user answers. Each task stores
  only its new generated fragment; Python reconstructs prompts/answers from the canonical owned
  commands. Retained legacy histories discard user/source requests and subtract the exact owned
  generated prefix, failing safely if that prefix is inconsistent.
- `study_guide_sources.py` binds queued task/owner/type/Job identity and expiry before
  reading current job text and valid completed prompts through narrow ordinary views.
  It preserves batch/slot order and rejects excess context without dropping history.
- `interview_questions.py` reads queued task-owned written-practice sources in one repeatable-read transaction. It checks set/subject ownership, target and peer revisions, then selects active generated slots and account-owned preferences. Feedback reads only the selected active question’s answer and current approvals at its commanded revisions. Narrow grants exclude feedback, vectors, provider receipts and accounting; retained source copies are checks only.

- `chat_inputs.py` verifies live owned operation fences, expected message position and
  saved summary checkpoints/plans in one repeatable-read transaction. It loads only
  pending input, uncovered accepted dialogue and rolling summary; profile contact is
  privacy-only. Private acceptance receipts, feedback and account secrets are not granted.

- `interview_auxiliary.py` verifies once-only claimed task/record/owner/current-prompt fences and
  reads canonical clarification prompts, bounded reference queries and completed feedback dialogue.
  Rails claim responses contain identities and timestamps, never these sources.
