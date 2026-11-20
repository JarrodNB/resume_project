#!/bin/bash
# Runs once, when the Postgres data directory is first created. Makes the Rails role and
# databases (matching config/database.yml) and the read-only AI role. Rails grants
# ai_reader its table access after migrations (`db:grant_ai_reader_access`).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username postgres <<SQL
CREATE ROLE api LOGIN PASSWORD '${API_DB_PASSWORD}';
CREATE ROLE ai_reader LOGIN PASSWORD '${AI_READER_DB_PASSWORD}';
CREATE DATABASE api_production OWNER api;
CREATE DATABASE api_production_cache OWNER api;
CREATE DATABASE api_production_cable OWNER api;
SQL

# pgvector must be enabled by a superuser before Rails migrations ask for it.
psql -v ON_ERROR_STOP=1 --username postgres --dbname api_production -c "CREATE EXTENSION IF NOT EXISTS vector;"
