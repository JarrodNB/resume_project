# AGENTS.md — services/api/app/graphql

## Purpose

The GraphQL API used by `apps/web`. Every request is authenticated by `GraphqlController`.

## Contents

- `api_schema.rb` — root schema; turns `RecordNotFound` into a "Record not found" error
- `types/` — object types, enums, inputs, and the root `query_type.rb` / `mutation_type.rb`
- `mutations/` — one file per mutation, grouped by domain (`mutations/jobs/create_job.rb`)
- `resolvers/` — generated base class (unused so far)

## Local Rules

- Root query fields read through `current_user` associations only.
- Mutations: find the record via `current_user`, call one service, return
  `payload_from(result, :record_key)`. Payloads always include `errors: [String!]!`.
- Inputs are `<Noun>AttributesInput` with all-optional fields, shared by create and update.
- Enum types mirror model constants with `extend EnumFromValues; values_from Model::CONSTANT`.
- No Relay `node` / global-ID lookups: they bypass user scoping.
- Test operations with `execute_graphql(query, user:, variables:)` from `spec/support`.
