-- Description: Runs once when the local Postgres volume is first created.
-- Creates the development database and a read-only role for the AI worker, so the
-- "AI never writes domain tables" rule is enforced by the database, not just convention.
-- Index:
--   - ai_reader role: login role with SELECT-only access
--   - api_development: created here so default privileges can be set inside it
--     (Rails `db:prepare` then loads the schema into the existing database)

CREATE ROLE ai_reader LOGIN PASSWORD 'ai_reader';

CREATE DATABASE api_development;

\connect api_development

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO ai_reader;
