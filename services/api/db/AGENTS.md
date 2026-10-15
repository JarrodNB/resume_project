# AGENTS.md — services/api/db

## Purpose

Database migrations and the generated schema.

## Contents

- `interview_question_embeddings` — derived vectors created by migration; one per question with cascading deletion, no historical migration/backfill.

- `migrate/` — migrations (each starts with a `# Description:` header)
- `schema.rb` — generated; never edit by hand
- `cache_schema.rb`, `queue_schema.rb`, `cable_schema.rb` — generated Solid* schemas (production only)
- `seeds.rb` — seed data (empty)

## Local Rules

- Primary keys are UUIDs (configured in `config/application.rb`).
- Add `null: false` and defaults for required columns; JSON columns default to `[]` or `{}`.
- Run: `docker compose run --rm api bin/rails db:migrate`.

- `20261010010000_create_certifications.rb` — independent user-owned credential table; leaves education intact.

- `20261010020000_add_certification_date_precision.rb` preserves year/month/day credential date precision.

- `20261010030000_create_interview_question_sets.rb` — practice sets and question slots with unique positions and revision constraints.
