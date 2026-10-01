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
  (`app/services/resumes/tailor_resume_service.rb`).
  - One public method: `call`. Invoke with `Resumes::TailorResumeService.call(...)`.
  - Return a simple result object (success/failure + value/errors).
- GraphQL resolvers and mutations stay thin: authorize, call a service, return the result.
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

Standard Rails 8.1 API-mode app (generated with `rails new --api --database=postgresql`).

- `Dockerfile.dev` — local dev image; runs `db:prepare` then Puma on port 3000
- `Dockerfile` — generated production image
- `config/database.yml` — connection comes from `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`
- `.env.example` — secrets template

Not added yet: GraphQL, Devise/JWT, Shoryuken, ActionCable subscriptions (Rails core step).
