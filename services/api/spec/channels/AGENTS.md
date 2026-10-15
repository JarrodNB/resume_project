# AGENTS.md — Channel specs

## Purpose and contents

- `graphql_channel_spec.rb` — task subscription initial state and ownership.
- `ai_usage_subscription_spec.rb` — usage subscription initial state and ownership.

## Local rules

Use synthetic users, the test ActionCable adapter, and real GraphQL execution. Never connect
to external services. Follow the parent spec instructions.
