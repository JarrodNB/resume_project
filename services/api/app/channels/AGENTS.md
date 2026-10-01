# AGENTS.md — services/api/app/channels

## Purpose

ActionCable over WebSocket at `/cable`, used for GraphQL subscriptions. Messages fan out
through Solid Cable (Postgres), so triggers from the `api-results-worker` process reach
clients connected to Puma.

## Contents

- `application_cable/connection.rb` — authenticates the JWT from the `token` query param
- `application_cable/channel.rb` — base channel
- `graphql_channel.rb` — runs GraphQL operations for the connected user (Apollo protocol)

## Local Rules

- Every connection is authenticated; there are no anonymous channels.
- Don't add domain channels. Live updates are GraphQL subscriptions (see `app/graphql/`).
