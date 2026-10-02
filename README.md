# Throughline (working name)

A job search assistant that pairs an AI-assisted resume builder with tools to organize
the whole search: tailoring resumes to jobs, gap analysis, a job board, and application tracking.

The AI works *with* the user. It asks questions and fills gaps instead of mass-generating
and mass-sending resumes.

## Repository Layout

- `apps/web` — React app
- `apps/landing` — landing page
- `services/api` — Rails GraphQL API
- `services/ai` — Python SQS workers for all LLM work
- `infra` — Terraform, Kubernetes, local ElasticMQ (SQS) config
- `docs` — architecture and plans

Start with `AGENTS.md` (conventions) and `docs/mvp_plan.md` (what we're building first).

## Running Locally

Requires only Docker Desktop.

```bash
cp services/ai/.env.example services/ai/.env     # add OpenAI and Langfuse keys
cp services/api/.env.example services/api/.env
docker compose up --build
```

| Service | URL / port              |
| ------- | ----------------------- |
| web     | http://localhost:5173   |
| landing | http://localhost:5174   |
| api     | http://localhost:3000 (GraphQL subscriptions: ws://localhost:3000/cable) |
| api-results-worker | consumes `ai_results` (no port) |
| ai      | consumes `ai_tasks` (no port) |
| db      | localhost:5432          |
| sqs     | http://localhost:9324   |
| s3      | http://localhost:9090 (S3Mock, bucket `throughline-uploads`) |

Reset the local database (deletes all local data): `docker compose down -v`.
After changing dependencies, rebuild: `docker compose up --build -V`.

## Status

- Done: local dev foundation; Rails core (JWT auth, career library / resume / job / AI task
  models, GraphQL API with job and experience mutations, RSpec suite); SQS round trip
  (Rails -> `ai_tasks` -> Python echo worker -> `ai_results` -> Rails, with live
  `aiTaskUpdated` GraphQL subscription); resume parsing (upload a PDF/DOCX via the
  `parseResume` mutation, Pydantic AI agent traced in Langfuse, review, then
  `importParsedResume` into the career library), with evals.
- Next: job scraping, gap analysis, tailoring, memory.

## Commands

Run these from the repo root. `exec` runs inside an already-running container;
`run --rm` starts a throwaway one (use it when the stack is down).

### Whole stack

| Task | Command |
| ---- | ------- |
| Start (detached) | `docker compose up -d` |
| Stop gracefully (keeps data) | `docker compose down` |
| Stop without removing containers | `docker compose stop` |
| Status | `docker compose ps` |
| Follow all logs | `docker compose logs -f` |
| Follow one service's logs | `docker compose logs -f <service>` |
| Restart one service | `docker compose restart <service>` |
| Rebuild after dependency changes | `docker compose up --build -V` |
| Reset database (deletes all local data) | `docker compose down -v` |

### api (Rails)

| Task | Command |
| ---- | ------- |
| Shell | `docker compose exec api bash` |
| Rails console | `docker compose exec api bin/rails console` |
| Specs | `docker compose run --rm api bundle exec rspec` |
| One spec file | `docker compose run --rm api bundle exec rspec spec/path/to_spec.rb` |
| Migrate | `docker compose run --rm api bin/rails db:migrate` |
| Generate a migration | `docker compose run --rm api bin/rails g migration <Name>` |
| Install gems (after editing `Gemfile`) | `docker compose run --rm api bundle install` |
| Dump GraphQL schema (after any GraphQL change) | `docker compose run --rm api bin/rails graphql:schema:dump` |
| Routes | `docker compose run --rm api bin/rails routes` |

`api-results-worker` shares the api image and gems; restart it after changing code it
loads: `docker compose restart api-results-worker`.

### ai (Python worker)

| Task | Command |
| ---- | ------- |
| Shell | `docker compose exec ai bash` |
| Tests | `docker compose run --rm ai pytest` |
| One test file | `docker compose run --rm ai pytest tests/path/to_test.py` |
| Resume parsing evals (real OpenAI calls) | `docker compose run --rm ai python -m evals.run_resume_parsing_evals` |
| Add a package | `docker compose run --rm ai uv add <package>`, then `docker compose up --build -V -d ai` |
| Restart after code changes | `docker compose restart ai` |

### web (React)

| Task | Command |
| ---- | ------- |
| Shell | `docker compose exec web sh` |
| Tests | `docker compose exec web npm test` |
| Type check | `docker compose exec web npm run typecheck` |
| Lint | `docker compose exec web npm run lint` |
| GraphQL codegen (after schema dump or operation changes) | `docker compose exec web npm run codegen` |
| Add a package | `docker compose run --rm --no-deps web npm install <package>`, then `docker compose up --build -V -d web` |
| Add a shadcn/ui component | `docker compose exec -T web npx shadcn@latest add <name> -y` |

### db (Postgres)

| Task | Command |
| ---- | ------- |
| psql (dev database) | `docker compose exec db psql -U postgres api_development` |
| List databases | `docker compose exec db psql -U postgres -c '\l'` |