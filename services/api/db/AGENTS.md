# AGENTS.md — services/api/db

## Purpose

Database migrations and the generated schema.

## Contents

- `migrate/` — migrations (each starts with a `# Description:` header)
- `schema.rb` — generated; never edit by hand
- `cache_schema.rb`, `queue_schema.rb`, `cable_schema.rb` — generated Solid* schemas (production only)
- `seeds.rb` — seed data (empty)

## Local Rules

- Primary keys are UUIDs (configured in `config/application.rb`).
- Add `null: false` and defaults for required columns; JSON columns default to `[]` or `{}`.
- Run: `docker compose run --rm api bin/rails db:migrate`.
