# AGENTS.md — services/api

## Purpose

Rails API and source of truth for domain data: users, resumes, resume sections, jobs,
applications, interviews, contacts, goals.

## Stack

Rails (API mode), PostgreSQL (RDS) with pgvector (`neighbor` gem), graphql-ruby, Devise + Rails sessions
auth, Shoryuken (SQS) for publishing AI jobs and consuming results, ActionCable with Solid Cable
for GraphQL subscriptions, the official `openai` gem for career-library and interview Q&A embeddings only.

## Local Rules

- **Business logic lives in service objects** under `app/services/`, grouped by domain
  (`app/services/jobs/move_job_to_stage_service.rb`). See `app/services/AGENTS.md`.
- GraphQL resolvers and mutations stay thin: authorize, call a service, return the result.
- Shared `JobBoardListing` and `JobBoardSearchPage` records contain only provider data and are
  intentionally unscoped by user. Authenticated Job Board operations may read these shared tables;
  they have no AI reader grant. All private-domain reads retain the rule below.
- **Every read goes through `current_user`** (`current_user.jobs.find(id)`), never
  `Job.find(id)`. That is the entire authorization model; a missing record and someone
  else's record both return "Record not found".
- Behavior changes ship with specs (RSpec + FactoryBot). Run: `docker compose run --rm api bundle exec rspec`.
- Models hold associations, validations, and scopes only.
- `ai_results` consumers must be idempotent: finished tasks keep their outcome. Usage reports
  are deduplicated by execution identity and may still add late charges to finished tasks.
- Live UI updates go through GraphQL subscriptions. Services trigger them
  (e.g. `Schema.subscriptions.trigger(:ai_task_updated, ...)`) after state changes;
  subscriptions authorize the user the same way queries do.

## Documentation

Use YARD comments for public service contracts, side effects, and non-obvious rules.
Start handwritten Ruby files with a short plain-English `#` header following the root
guidance; tiny, self-explanatory files and generated code can skip it.

## Contents

Rails 8.1 API-mode app. Nested guides add domain-specific rules; parent instructions apply.
Configuration must work in Docker development and production. Preserve owned data and AI usage records.

- `app/models/` — domain models (career library, resumes, jobs, AI tasks, interview practice sets/questions)
- `app/services/` — service objects (all business logic)
- `app/graphql/` — GraphQL schema, types, mutations, subscriptions
- `app/controllers/` — GraphQL endpoint and REST auth controllers
- `app/channels/` — ActionCable: cookie-authenticated WebSocket at `/cable`, GraphQL channel
- `app/workers/` — Shoryuken workers (run by the `api-results-worker` compose service)
- `app/jobs/` — durable Solid Queue jobs on the primary database (career-library and
  question-specific interview embedding sync, account email); run `bin/jobs` separately
- `db/` — migrations and schema (UUID primary keys)
- `spec/` — RSpec specs and FactoryBot factories
- `config/routes.rb` — `/auth/*` (REST, cookie sessions), `/graphql`, `/up`
- `config/initializers/devise.rb` — Devise settings; `session_store.rb` — session serialization;
  `cors.rb` — explicit credentialed origins
  (also used for WebSocket origins in `config/application.rb`)
- `config/initializers/shoryuken.rb` — SQS client (ElasticMQ locally), queue name constants
- `config/shoryuken.yml` — Shoryuken process config (queues it consumes, concurrency)
- `config/initializers/ai_usage_limits.rb` — independent general AI and spoken-interview
  limits (monthly budget, hourly starts, in-flight work) from ENV
- `config/initializers/text_limits.rb` — character and count caps for user-written text
  (`TextLimits`) and `MaxRequestBody` (JSON 413 over 8 MB, including a body with no
  Content-Length). The AI worker repeats the caps it
  enforces in `services/ai/text_limits.py`
- `config/initializers/career_library_embeddings.rb` — `CareerLibraryEmbeddings::MODEL`
  (`EMBEDDING_MODEL`, default `text-embedding-3-small`) and `DIMENSIONS` (1536); must match the
  AI worker's `embedding_model` / `embedding_dimensions`
- `lib/tasks/career_library_embeddings.rake` — `career_library:sync_embeddings` backfills every
  user's library embeddings (only new or changed entries call OpenAI)
- `config/initializers/rack_attack.rb` — request throttles (sign-in, sign-up, GraphQL) on
  `Rails.cache`; JSON 429 responses
- `config/cable.yml` — Solid Cable in development and production (own `cable` database)
- `lib/ai_reader_access.rb` + `lib/tasks/ai_reader_access.rake` — `db:grant_ai_reader_access`
  grants the AI worker's read-only `ai_reader` role SELECT on the job and career library tables
  and `library_embeddings` (of `users`, `id`, `summary`, `screened_fields`, `name`, `contact_email`, `phone`, `location`, and `links`;
  the sign-in email and password stay hidden). It runs after `db:prepare`, `db:migrate`, and
  `db:schema:load` (schema.rb doesn't keep grants) and skips if the role doesn't exist. A table
  the AI worker must read needs to be added there; tailoring has narrow gap-response columns and a completed-analysis-only output view.
  `ai_tasks` grants only `id`, `user_id`, `task_type`, `status` and `input` for owned queued
  command loading; result, history and accounting columns remain hidden.
  Summary reads also grant only resumes(id,user_id), resume_sections(id,resume_id,section_type,content,position),
  and the non-materialized ai_accepted_resume_prose(user_id,prose) projection of accepted generated prose.
  `spec/lib/ai_reader_access_spec.rb` checks what the role can and can't see
- `graphql_schema/schema.graphql` — GraphQL SDL dump read by `apps/web` codegen (in its own
  folder so the web container mounts the folder and always sees the latest dump). Regenerate after any
  GraphQL change with `docker compose run --rm api bin/rails graphql:schema:dump`
  (`lib/tasks/graphql_schema.rake`); `spec/graphql/schema_dump_spec.rb` fails if it's stale
- `Dockerfile.dev` — local dev image; `Dockerfile` — generated production image
- `.env.example` — secrets template

Gems are installed into the `api_bundle` volume: add one with
`docker compose run --rm --no-deps api bundle add <gem>` (no rebuild needed).

The Shoryuken process doesn't pick up code reloads: after editing a worker or a service it
calls, run `docker compose restart api-results-worker`.

Uploads use Active Storage on the `amazon` service (`config/storage.yml`): S3Mock in
development (`S3_ENDPOINT_URL`, `S3_UPLOADS_BUCKET` from docker compose), local disk in tests.
Production still points at `:local` and must switch to `:amazon` at deploy time.

Spoken interview media uses `Interviews::MediaStorage` directly in a private S3 namespace,
outside Active Storage signed routes. Rails seals staged bytes and grants brief object-only
URLs. Browser URLs use `INTERVIEW_BROWSER_STORAGE_ORIGIN`; executor URLs use
`S3_ENDPOINT_URL`. Local S3Mock storage is persistent; Rails cleanup owns retention.

Every service that changes career library text must enqueue
`CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(user_id)` (it runs after commit, and an
extra sync is harmless). `OPENAI_API_KEY` must be set in `services/api/.env` for embeddings;
without it the sync is skipped.

Future successful nonblank interview answer saves enqueue `InterviewPrep::SyncQuestionEmbeddingJob`
after commit. Vectors remain separate from the career library and AI reader grants. Rails embedding
jobs retain separate embedding receipts included in per-user general/combined spend, without
queued-task hourly admissions or concurrency slots. They remain outside Logfire tracing.

Resume tailoring mutations support start, save, section updates, and owned deletion.
Deletion removes saved sections while keeping the job, library, and accepted task history.
