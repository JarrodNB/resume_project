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
| api     | http://localhost:3000   |
| db      | localhost:5432          |
| sqs     | http://localhost:9324   |

Reset the local database (deletes all local data): `docker compose down -v`.
After changing dependencies, rebuild: `docker compose up --build -V`.

## Status

Local dev foundation in place (all services scaffolded and running). Next: Rails core.
