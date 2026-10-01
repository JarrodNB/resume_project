# AGENTS.md — services/api/spec

## Purpose

RSpec suite. Run with `docker compose run --rm api bundle exec rspec`.

## Contents

- `models/` — validations, enums, ordering
- `services/` — service object behavior, mirrored from `app/services/`
- `graphql/queries/`, `graphql/mutations/` — operations run directly against the schema
- `requests/auth_spec.rb` — end-to-end JWT sign-up, sign-in, sign-out over HTTP
- `channels/` — WebSocket JWT auth and subscriptions run through `GraphqlChannel`
- `workers/` — Shoryuken workers (called directly with a parsed body)
- `factories/` — one FactoryBot factory per model
- `support/graphql_helpers.rb` — `execute_graphql(query, user:, variables:)`

## Local Rules

- Every new service, mutation, or query gets a spec, including an ownership check for
  anything that takes an `id`.
- Use factories (`create(:job, user: user)`), not fixtures.
- Never call SQS from specs: stub `Shoryuken::Client.queues` and `ApiSchema.subscriptions`.
