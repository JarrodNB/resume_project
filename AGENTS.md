# AGENTS.md — Root

Guidance for LLM agents (and humans) working anywhere in this monorepo.
Read applicable ancestor `AGENTS.md` files and any local instructions before editing.
Add nested instructions only where a module needs rules beyond its parent.

## Project Summary

**Careergrind**. A job search assistant. The AI collaborates with the user to write tailored resumes
(no mass-generated, mass-sent resumes) and keeps the job search organized and focused.
First milestone: the AI engineering core (see `docs/mvp_plan.md`).

## Project Index

| Path                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `apps/web/`          | React (Vite + TypeScript) app, Apollo GraphQL client           |
| `apps/landing/`      | Marketing landing page that redirects into the app             |
| `services/api/`      | Rails API: GraphQL, auth, core domain, service objects         |
| `services/ai/`       | Python SQS workers: OpenAI calls, scraping, memory, Logfire   |
| `infra/`             | Terraform (AWS), Kubernetes manifests, local ElasticMQ config  |
| `docs/`              | Architecture, MVP plan, decisions                              |
| `GLOSSARY.md`        | Shared domain terms                                            |
| `.github/workflows/` | CI and automated deployment (created when first needed)        |

## Code Conventions

1. **Prefer cohesive modules.** Keep related behavior together. Split when responsibilities,
   dependencies, or reasons to change diverge, not solely because of line count.
2. **Use descriptive names** that support code search. Prefer `tailor_resume_for_job` over
   `process`; avoid unexplained abbreviations.
3. **Explain files for humans.** By default, start handwritten code files with a short,
   plain-English header explaining what the file helps do, where it fits, and any important
   limits or side effects. Aim for an ELI5 explanation without losing accuracy. Tiny,
   self-explanatory files and generated code can skip it. See the example below.
   Document public interfaces, LLM tools, and non-obvious business or authorization rules
   where needed. Export indexes and comments on every method are not required.
4. **Keep instructions scoped.** Root rules apply everywhere; nested `AGENTS.md` files add
   local constraints. Do not create a guide for every folder or maintain exhaustive file
   inventories. Update affected guidance when its rules or navigation change.
5. **Keep designs simple.** Follow established patterns; avoid speculative abstractions.
   Keep orchestration separate from business logic and preserve dependency directions.
6. **Inspect relevant code first.** Ask when requirements are ambiguous. Keep changes focused.
7. **Rails business logic lives in service objects** (`services/api/app/services/`), not in
   controllers, resolvers, or models.
8. **Read docs on demand.** See `docs/architecture.md` for ownership, queue contracts, and
   dependency directions; consult it before changing those contracts. Use `GLOSSARY.md`
   for domain terms. Update affected docs when behavior or design changes; avoid duplication.
9. **Verify changes.** Follow `docs/testing.md` for focused tests, lint, schema generation,
   and offline vs. paid eval commands. Test changed behavior through observable interfaces.
   Report checks and limitations.
10. **History lives in git**, not file headers. Do not hand-edit generated code; use its
    generator. Generated files do not need added metadata headers.
11. **Keep language simple.** Write like you are talking to a college student.

## Human-friendly file headers

Use a few sentences rather than a function inventory. Explain the job in everyday language;
include important limits when they matter. Use the language's normal comment syntax
(Python module docstrings, Ruby `#` comments, TypeScript `/** ... */`). Keep required
language directives first. For example:

```python
"""Find career examples that could help answer an interview question.

Searches only the current user's saved career library. Returns evidence
for the writing agent; it does not write or save an answer.
"""
```

Apply this when adding or meaningfully editing a file. Preserve useful existing details,
keep headers accurate as behavior changes, and avoid a repository-wide header rewrite.

## Cross-Service Rules

- Rails is the source of truth for domain data. The AI service connects with a read-only
  database role and returns everything it produces via the `ai_results` queue.
- SQS can deliver a message more than once. Every handler on either side of the queue must
  be safe to run twice (see "Duplicate Messages" in `docs/architecture.md`).
- Long-running AI work goes through SQS (ElasticMQ locally), never synchronous HTTP.
- All LLM calls go through the AI service and are traced in Logfire. One exception: Rails
 embeds career library entries and saved interview Q&A itself (OpenAI embeddings API,
 `CareerLibrary::SyncLibraryEmbeddingsJob` and `InterviewPrep::SyncQuestionEmbeddingJob`),
 because embeddings are derived data with no prompt and are too large to return over SQS. The
 AI service embeds search queries through Pydantic AI as usual. These independent Rails
 jobs are outside AI-task budgets/attempt reports and Logfire tracing; they still incur provider costs.
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
