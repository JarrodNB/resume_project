# AGENTS.md — Root

Guidance for LLM agents (and humans) working anywhere in this monorepo.
Read applicable ancestor `AGENTS.md` files and any local instructions before editing.
Add nested instructions only where a module needs rules beyond its parent.

Before planning or implementing, fetch origin and compare HEAD with origin/master. Report stale code before making architectural recommendations.

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
| `services/ai/`       | Python HTTP execution and SQS workers: models, memory, Logfire   |
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
   offline vs. paid eval commands, and reusable development account credentials.
   Test changed behavior through observable interfaces.
   Report checks and limitations.
10. **History lives in git**, not file headers. Do not hand-edit generated code; use its
    generator. Generated files do not need added metadata headers.
11. **Keep language simple.** Write like you are talking to a college student.
12. **Do design work on a branch.** For Impeccable and frontend design changes,
    use a dedicated `codex/` branch rather than editing on the default branch.
    Build new surfaces directly in code by default; see `.impeccable/config.json`.
13. DO NOT JSON DUMP INTO PROMPTS

## Things we've learned to do
Format text before it goes into a prompt
Do not screen text that we generated or has already been screened and recorded
Make sure traces are proper and include cost


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
  database role and returns everything it produces via the `ai_results` queue, except
  interactive interview and chat results accepted through their scoped internal HTTP boundaries below.
- SQS can deliver a message more than once. Every handler on either side of the queue must
  be safe to run twice (see [Duplicate Messages](docs/architecture/ai-tasks.md#duplicate-messages)).
- Long-running AI work goes through SQS (ElasticMQ locally). Interactive interviews and chat are the
  scoped exceptions: the shared AI-service FastAPI runtime claims durable Rails-owned
  operations over authenticated internal HTTP and runs them asynchronously using the
  same execution runner, leases and recovery jobs. Browser requests never wait for
  model execution. Chat opts into the shared streaming layer; interviews retain final
  results. See docs/architecture/interview-sessions.md and docs/architecture/chat.md.
- All LLM calls go through the AI service and are traced in Logfire. One exception: Rails
 embeds career library entries and saved interview Q&A itself (OpenAI embeddings API,
 `CareerLibrary::SyncLibraryEmbeddingsJob` and `InterviewPrep::SyncQuestionEmbeddingJob`),
 because embeddings are derived data with no prompt and are too large to return over SQS. The
 AI service embeds search queries through Pydantic AI as usual. These independent Rails
 jobs retain separate durable embedding receipts included in per-user general/combined spend;
 they create no AI-task hourly admission or concurrency slot and remain outside Logfire tracing.
- Secrets come from environment variables; never commit them. Each service has its own
  `.env` (copied from its `.env.example`).

## Running Things

- Local development runs in Docker. Do not assume Ruby, Node, or Python are installed on the host.
- In managed cloud, run natively without Docker. Follow `docs/native-development.md`,
  `script/install-native-cloud.sh`, and `script/start-native-cloud.sh` for installation,
  startup, prerequisites, and emulator limits.
- The host is native Ubuntu with bash. The current checkout is at
  `/home/jarrod/Desktop/resume_project`. Use Linux commands and Docker Engine with the
  Docker Compose plugin; run commands from the checkout being changed.
- Local dev uses the root `docker-compose.yml`. Run commands inside containers, e.g.
  `docker compose run --rm api bin/rails db:migrate` or `docker compose run --rm ai-worker pytest`.
- Each app/service has a `Dockerfile.dev` for local dev (source is bind-mounted, so code
  changes apply without rebuilding). Production images use a separate `Dockerfile` and
  are what gets deployed to Kubernetes.
- Rebuild after dependency changes: `docker compose up --build -V`.
