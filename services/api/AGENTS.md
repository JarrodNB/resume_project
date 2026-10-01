# AGENTS.md — services/api

## Purpose

Rails API and source of truth for domain data: users, resumes, resume sections, jobs,
applications, interviews, contacts, goals.

## Stack

Rails (API mode), PostgreSQL (RDS) with pgvector, graphql-ruby, Devise + JWT auth,
Shoryuken (SQS) for publishing AI jobs and consuming results, ActionCable with Solid Cable
for GraphQL subscriptions.

## Local Rules

- **Business logic lives in service objects** under `app/services/`, grouped by domain
  (`app/services/jobs/move_job_to_stage_service.rb`). See `app/services/AGENTS.md`.
- GraphQL resolvers and mutations stay thin: authorize, call a service, return the result.
- **Every read goes through `current_user`** (`current_user.jobs.find(id)`), never
  `Job.find(id)`. That is the entire authorization model; a missing record and someone
  else's record both return "Record not found".
- Every change ships with specs (RSpec + FactoryBot). Run: `docker compose run --rm api bundle exec rspec`.
- Models hold associations, validations, and scopes only.
- `ai_results` consumers must be idempotent: look up the `AiTask` by `ai_task_id` and ignore
  results for tasks that are already `completed` or `failed`.
- Live UI updates go through GraphQL subscriptions. Services trigger them
  (e.g. `Schema.subscriptions.trigger(:ai_task_updated, ...)`) after state changes;
  subscriptions authorize the user the same way queries do.

## File Header Format

Every Ruby file starts with:

```ruby
# Description: Tailors a resume to a job profile by selecting and rewriting sections.
# Index:
#   - call: runs the tailoring flow and returns a TailoredResume
#   - select_relevant_sections: picks sections matching job requirements
```

Every method gets a one-line YARD-style comment describing what it does.

## Contents

Rails 8.1 API-mode app. Folders we own have their own `AGENTS.md`; generated framework
folders (`config/`, `bin/`, `lib/`, `public/`) are covered by this file.

- `app/models/` — domain models (career library, resumes, jobs, AI tasks)
- `app/services/` — service objects (all business logic)
- `app/graphql/` — GraphQL schema, types, mutations, subscriptions
- `app/controllers/` — GraphQL endpoint and REST auth controllers
- `app/channels/` — ActionCable: JWT-authenticated WebSocket at `/cable`, GraphQL channel
- `app/workers/` — Shoryuken workers (run by the `api-results-worker` compose service)
- `db/` — migrations and schema (UUID primary keys)
- `spec/` — RSpec specs and FactoryBot factories
- `config/routes.rb` — `/auth/*` (REST, JWT), `/graphql`, `/up`
- `config/initializers/devise.rb` — JWT settings at the bottom; `cors.rb` — allowed origins
  (also used for WebSocket origins in `config/application.rb`)
- `config/initializers/shoryuken.rb` — SQS client (ElasticMQ locally), queue name constants
- `config/shoryuken.yml` — Shoryuken process config (queues it consumes, concurrency)
- `config/cable.yml` — Solid Cable in development and production (own `cable` database)
- `Dockerfile.dev` — local dev image; `Dockerfile` — generated production image
- `.env.example` — secrets template

Gems are installed into the `api_bundle` volume: add one with
`docker compose run --rm --no-deps api bundle add <gem>` (no rebuild needed).

The Shoryuken process doesn't pick up code reloads: after editing a worker or a service it
calls, run `docker compose restart api-results-worker`.

Uploads use Active Storage on the `amazon` service (`config/storage.yml`): S3Mock in
development (`S3_ENDPOINT_URL`, `S3_UPLOADS_BUCKET` from docker compose), local disk in tests.
Production still points at `:local` and must switch to `:amazon` at deploy time.

Not added yet: mutations for projects, educations, skills, and resumes (follow the
jobs/experiences pattern).
