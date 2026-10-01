# AGENTS.md — services

Backend services.

- `api/` — Rails GraphQL API (source of truth for domain data)
- `ai/` — Python SQS workers for all LLM work

They communicate over SQS: `api` publishes AI tasks, `ai` publishes results back.
See each subfolder's `AGENTS.md` for local rules.
