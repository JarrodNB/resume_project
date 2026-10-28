# AGENTS.md — services/api/app/channels

## Purpose

ActionCable over WebSocket at `/cable`, used for GraphQL subscriptions. Messages fan out
through Solid Cable (Postgres), so triggers from the `api-results-worker` process reach
clients connected to Puma.

## Contents

- `application_cable/connection.rb` — authenticates the persisted cookie session
- `application_cable/channel.rb` — base channel
- `graphql_channel.rb` — runs only GraphQL subscriptions for the connected user (Apollo protocol)

## Local Rules

- Every connection is authenticated; there are no anonymous channels.
- Queries and mutations use HTTP, where CSRF and request throttles apply. Cable rejects them before resolution.
- Use the same persisted-session check as HTTP. Validate before operations and
  private transmissions; the normal heartbeat closes invalid/expired connections.
  Keep trusted-origin enforcement. Never put session credentials in WebSocket URLs.
- Don't add domain channels. Live updates are GraphQL subscriptions (see `app/graphql/`).
