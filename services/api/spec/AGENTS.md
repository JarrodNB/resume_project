# AGENTS.md — services/api/spec

## Purpose

RSpec suite. Run with `docker compose run --rm api bundle exec rspec`.

## Contents

- `models/` — validations, enums, ordering
- `services/` — service object behavior, mirrored from `app/services/`
- `graphql/queries/`, `graphql/mutations/` — operations run directly against the schema
- `graphql/schema_dump_spec.rb` — fails when `schema.graphql` is out of date
- `requests/auth_spec.rb` — signup verification pending, cookie sign-in/out over HTTP
- `requests/email_verification_spec.rb` — Devise confirmation, resend, errors, CSRF and queue failure
- `requests/browser_sessions_spec.rb` — bootstrap, CSRF, cookie replay, and expiry
- `requests/rack_attack_spec.rb` — throttles (swaps in a memory cache; the test cache is a
  null store, so throttles never trip in other specs)
- `routing/auth_routes_spec.rb` — explicit signup/session/POST confirmation routes;
  no account delete/update or password reset yet
- `channels/` — persisted-session WebSocket auth and subscriptions through `GraphqlChannel`
- `workers/` — Shoryuken workers (called directly with a parsed body)
- `jobs/` — Active Job jobs (performed inline with stubbed services)
- `lib/ai_reader_access_spec.rb` — what the AI worker's `ai_reader` role can read (runs
  queries as that role inside a rolled-back savepoint)
- `factories/` — one FactoryBot factory per model
- `support/graphql_helpers.rb` — `execute_graphql(query, user:, variables:)`
- `support/uploaded_file_helpers.rb` — `build_uploaded_file(content:, filename:)`,
  `minimal_pdf_bytes` (in-memory uploads; no binary fixtures)
- `support/fake_embedding_client.rb` — `FakeEmbeddingClient`: deterministic vectors, records
  every embedded text; pass it as `embedding_client:` to the sync service

## Local Rules

- Every new service, mutation, or query gets a spec, including an ownership check for
  anything that takes an `id`.
- Use factories (`create(:job, user: user)`), not fixtures.
- Never call SQS from specs: stub `Shoryuken::Client.queues` and `ApiSchema.subscriptions`.
- Never call OpenAI from specs: use `FakeEmbeddingClient`; check sync enqueueing with
  `have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)`.
- Time-dependent specs use `travel_to` (`ActiveSupport::Testing::TimeHelpers` is included).

- Certification factory, GraphQL lifecycle/ownership and reviewed-import specs cover independent credentials and legacy uploads.

- `models/interview_question_set_spec.rb` — practice persistence, ordering, validation, deletion, and answer isolation.

- `services/interview_prep/`, `graphql/mutations/interview_prep_spec.rb`, and `graphql/queries/interview_prep_spec.rb` — practice operations, queue snapshots, allowance failures, answer limits/revisions, and set/question authorization.
