-- Description: Runs once when the local Postgres volume is first created.
-- Creates the development database and a read-only role for the AI worker, so the
-- "AI never writes domain tables" rule is enforced by the database, not just convention.
-- The role's table grants come from Rails (`bin/rails db:grant_ai_reader_access`, run
-- automatically after db:prepare and db:migrate), since the tables don't exist yet here.
-- Index:
--   - ai_reader role: login role, no table access until Rails grants it
--   - api_development: created here so Rails `db:prepare` loads the schema into it

CREATE ROLE ai_reader LOGIN PASSWORD 'ai_reader';

CREATE DATABASE api_development;
