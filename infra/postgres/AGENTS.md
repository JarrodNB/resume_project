# AGENTS.md — infra/postgres

## Purpose

Local Postgres setup used by docker compose.

## Contents

- `init/01_create_ai_reader_role.sql` — creates `api_development` and the read-only
  `ai_reader` role (login only, no privileges) used by the AI worker

## Local Rules

- Init scripts only run when the `db_data` volume is first created. After changing them,
  reset the local database: `docker compose down -v` (this deletes all local data).
- Table grants for `ai_reader` don't live here: Rails applies them
  (`services/api/lib/ai_reader_access.rb`, run after `db:prepare` / `db:migrate`), so changing
  them needs no reset.
- Production roles are managed in Terraform/RDS, and must keep the same read-only rule for the AI worker.
