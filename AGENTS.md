# AGENTS.md — Root

Guidance for LLM agents (and humans) working anywhere in this monorepo.
Every folder has its own `AGENTS.md` with local rules; read the nearest one before editing.

## Project Summary

**Throughline** (working name, may change). A job search assistant. The AI collaborates with the user to write tailored resumes
(no mass-generated, mass-sent resumes) and keeps the job search organized and focused.
First milestone: the AI engineering core (see `docs/mvp_plan.md`).

## Project Index

| Path                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `apps/web/`          | React (Vite + TypeScript) app, Apollo GraphQL client           |
| `apps/landing/`      | Marketing landing page that redirects into the app             |
| `services/api/`      | Rails API: GraphQL, auth, core domain, service objects         |
| `services/ai/`       | Python SQS workers: OpenAI calls, scraping, memory, Langfuse   |
| `infra/`             | Terraform (AWS), Kubernetes manifests, local ElasticMQ config  |
| `docs/`              | Architecture, MVP plan, decisions                              |
| `.github/workflows/` | CI and automated deployment (created when first needed)        |

## Code Conventions

1. **Small, modular, reusable files.** One responsibility per file. If a file grows past
   ~150 lines, look for a split.
2. **Descriptive names** for files, classes, methods, and variables. Prefer
   `tailor_resume_for_job` over `process`. No unexplained abbreviations.
3. **Every file starts with a header** containing a description and an index of its
   public methods/exports. The exact format for each language is in the folder's `AGENTS.md`.
4. **Every method/function has a short description** (docstring, YARD, or JSDoc).
5. **Do not overcomplicate.** Pick the simplest thing that works; no speculative abstractions.
6. **Ask for clarification** when requirements are ambiguous instead of guessing.
7. **Every folder has an `AGENTS.md`** describing its purpose, contents, and local rules. Update it when you add, rename, or remove files.
8. **Rails business logic lives in service objects** (`services/api/app/services/`), not in
   controllers, resolvers, or models.
9. **History lives in git**, not in file headers. Write clear commit messages.
10. **Generated framework boilerplate** (from `rails new`, `create-vite`, etc.) is exempt from
    the header rule until we edit it. Add the header the first time a generated file is changed.

## Cross-Service Rules

- Rails is the source of truth for domain data. The AI service connects with a read-only
  database role and returns everything it produces via the `ai_results` queue.
- SQS can deliver a message more than once. Every handler on either side of the queue must
  be safe to run twice (see "Duplicate Messages" in `docs/architecture.md`).
- Long-running AI work goes through SQS (ElasticMQ locally), never synchronous HTTP.
- All LLM calls go through the AI service and are traced in Langfuse.
- Secrets come from environment variables; never commit them. Each service has its own
  `.env` (copied from its `.env.example`).

## Running Things

- Everything runs in Docker. Do not assume Ruby, Node, or Python are installed on the host.
- The host shell is bash in WSL2 Ubuntu (repo at `~/resume_project`), with Docker Desktop's
  WSL integration. Use Linux commands, not PowerShell.
- Local dev uses the root `docker-compose.yml`. Run commands inside containers, e.g.
  `docker compose run --rm api bin/rails db:migrate` or `docker compose run --rm ai pytest`.
- Each app/service has a `Dockerfile.dev` for local dev (source is bind-mounted, so code
  changes apply without rebuilding). Production images use a separate `Dockerfile` and
  are what gets deployed to Kubernetes.
- Rebuild after dependency changes: `docker compose up --build -V`.
