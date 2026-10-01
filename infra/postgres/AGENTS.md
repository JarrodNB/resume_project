# AGENTS.md — infra/postgres

## Purpose

Local Postgres setup used by docker compose.

## Contents

- `init/01_create_ai_reader_role.sql` — creates `api_development` and the read-only
  `ai_reader` role used by the AI worker

## Local Rules

- Init scripts only run when the `db_data` volume is first created. After changing them,
  reset the local database: `docker compose down -v` (this deletes all local data).
- Production roles are managed in Terraform/RDS, and must keep the same read-only rule for the AI worker.
