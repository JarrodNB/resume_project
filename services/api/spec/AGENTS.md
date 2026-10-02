# AGENTS.md — services/api/spec

## Purpose

RSpec suite. Run with `docker compose run --rm api bundle exec rspec`.

## Contents

- `models/` — validations, enums, ordering
- `services/` — service object behavior, mirrored from `app/services/`
- `graphql/queries/`, `graphql/mutations/` — operations run directly against the schema
- `graphql/schema_dump_spec.rb` — fails when `schema.graphql` is out of date
- `requests/auth_spec.rb` — end-to-end JWT sign-up, sign-in, sign-out over HTTP
- `requests/rack_attack_spec.rb` — throttles (swaps in a memory cache; the test cache is a
  null store, so throttles never trip in other specs)
- `routing/auth_routes_spec.rb` — only sign up/in/out are routed (no account delete or
  password reset)
- `channels/` — WebSocket JWT auth and subscriptions run through `GraphqlChannel`
- `workers/` — Shoryuken workers (called directly with a parsed body)
- `factories/` — one FactoryBot factory per model
- `support/graphql_helpers.rb` — `execute_graphql(query, user:, variables:)`
- `support/uploaded_file_helpers.rb` — `build_uploaded_file(content:, filename:)`,
  `minimal_pdf_bytes` (in-memory uploads; no binary fixtures)

## Local Rules

- Every new service, mutation, or query gets a spec, including an ownership check for
  anything that takes an `id`.
- Use factories (`create(:job, user: user)`), not fixtures.
- Never call SQS from specs: stub `Shoryuken::Client.queues` and `ApiSchema.subscriptions`.
- Time-dependent specs use `travel_to` (`ActiveSupport::Testing::TimeHelpers` is included).
