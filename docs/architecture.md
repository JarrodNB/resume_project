# Architecture

Careergrind uses Rails for domain data and Python workers for queued AI work.
This page covers service ownership and dependency directions. Read the focused guides
when changing a contract or feature:

| Guide | Read when changing |
| --- | --- |
| [Authentication](architecture/authentication.md) | Browser sessions, CSRF, login/logout, live connection security |
| [Career chat](architecture/chat.md) | Saved conversations, guarded streaming replies, rolling context and feedback |
| [AI streaming](architecture/ai-streaming.md) | Optional public output, observer capabilities and cross-replica replay |
| [AI tasks](architecture/ai-tasks.md) | Task lifecycle, queue payloads, duplicate handling, retries, uploads |
| [Rails background jobs](architecture/background-jobs.md) | Durable job storage, transactional enqueue and queue-worker operations |
| [Job Board](architecture/job-board.md) | Shared US catalogue, on-demand search, caching, private saved Job imports |
| [Interview sessions](architecture/interview-sessions.md) | Spoken interview records, atomic acceptance, HTTP boundary and recovery ownership |
| [Study guides](architecture/study-guides.md) | Job-description learning material, queued generation and retained results |
| [Interview prep](architecture/interview-prep.md) | Sets, revisions, locking, feedback, saved Q&A embeddings |
| [AI safety and usage](architecture/ai-safety-and-usage.md) | Screening, privacy, tracing, execution limits, cost accounting |
| [AI cost accounting](architecture/ai-cost-accounting.md) | Combined spend, background embedding receipts, price checks, verified reconciliation |
| [Career library](architecture/career-library.md) | Imports, merging, retrieval, embeddings, gap analysis, tailoring, job ingestion |

Decision rationale lives beside the behavior it explains in these guides.

## Core rules

- Rails owns domain writes. AI workers read through the restricted `ai_reader` role and return results over SQS
  (interactive interviews and chat use their scoped Rails acceptance interfaces).
- Long-running AI work goes through queues. Interactive interviews and chat are scoped exceptions: the shared
  FastAPI runtime claims durable Rails operations over internal HTTP; browser requests
  do not wait for execution. Both features use the same execution runner and durable
  fallback/recovery layer; chat enables its optional streaming output. Both transports
  must tolerate repeated work and results.
- LLM calls run in the AI service and are traced in Logfire. Rails background jobs embed career-library entries and saved interview Q&A as an explicit exception; see [embedding ownership](architecture/career-library.md#decisions).
- Secrets come from per-service environment variables.

## Services

```
            ┌──────────────┐        ┌──────────────┐
 landing ──▶│   apps/web   │──GQL──▶│ services/api │──▶ Postgres (RDS + pgvector)
            └──────────────┘        │    (Rails)   │
                                    └──────┬───────┘
                                  ai_tasks │ ▲ ai_results
                                       SQS ▼ │ SQS
                                    ┌──────────────┐
                                    │ services/ai  │──▶ OpenAI
                                    │   (Python    │──▶ Logfire
                                    │   workers)   │
                                    └──────────────┘
 Lambda (scheduled) ──▶ daily goal emails, weekly summaries, periodic job searches
```

## Code navigation and dependency directions

Start with the module responsible for the behavior; read detailed docs only as needed.

| Concern | Entry points and ownership |
| --- | --- |
| UI behavior | `apps/web/src/features/<feature>/`; hooks call GraphQL, shared UI lives in `components/` |
| Domain mutations | Rails `app/graphql/` authorizes and calls `app/services/<domain>/`; models hold persistence rules |
| Queued AI work | Python `worker/` dispatches tasks and coordinates domain helpers, agents, and queue results |
| Shared AI execution support | `settings.py`, `llm/`, `privacy/` and `telemetry/` serve HTTP execution and workers without queue startup dependencies |
| Model behavior | `agents/` registers prompts, tools, and structured outputs; `prompts/` owns instructions |
| Read-only retrieval | `database/` owns SQL scoped to the task user; `memory/` owns retrieval and query embeddings |
| Shared AI data shapes | `schemas/` owns structured models and pure validation; Rails and web consumers mirror queue results |
| Verification | API `spec/`, AI `tests/` and `evals/`, colocated frontend tests; see [testing.md](testing.md) |

Keep shared schemas independent of runtime orchestration: they may depend on other schemas
and external validation libraries, but must not import other first-party AI modules.
`tests/test_schema_dependencies.py` enforces this direction using Python's syntax tree,
including imports inside functions and type-checking blocks. It checks static imports;
dynamic imports and runtime side effects require review. This lets workers, agents,
retrieval, and offline evaluations share contracts without importing one another through
the schemas. `tests/test_shared_ai_support.py` also imports HTTP/model helpers in a fresh interpreter
and verifies that they neither load worker modules nor validate queue-only settings.
Other dependency directions above remain review rules, not automated checks.

Prefer cohesive modules with small public interfaces. Split by responsibility or distinct
dependencies rather than a fixed line limit. By default, give handwritten code files a short,
plain-English header explaining their job, place in the workflow, and important limits;
tiny, self-explanatory files and generated code can skip it. Keep useful contract comments
and model-facing tool descriptions; export indexes and comments repeating method names
add maintenance. Apply header improvements as files are meaningfully edited.
Nested `AGENTS.md` files are for additional local constraints, not exhaustive file inventories.
Domain-specific guides remain useful where they record ownership, retry, privacy, or UI rules.

## System decisions

- **Rails-owned auth** (Devise + server-side Rails sessions). Browsers keep an
  HttpOnly session cookie; credentials are not stored in localStorage.
  See [authentication](architecture/authentication.md) for transport and rollout.

- **Pydantic AI for all agent work.** It provides typed structured outputs, tools, and
  dependency injection, and switching LLM providers is a config change. Its deferred
  tools match our SQS pause/resume flow, and its OpenTelemetry instrumentation sends
  traces and token/cost metrics to Logfire without a custom wrapper. The AI startup
  uses Pydantic AI's native background price updater when remote tracing is enabled
  so newly released models can receive current upstream prices without blocking startup.
  Costs appear on new model spans and aggregate onto parent spans. This does not
  backfill historical traces or replace the separate Rails budget accounting.

- **Page sections are collapsible and start collapsed.** Long pages are a stack of titled
  sections (the career library, a job, a tailored resume). Each starts collapsed and stays that
  way until the user opens it. The browser remembers the open ones in localStorage
  (`careergrind.openSections`), the same way it remembers the color theme, so the choice is not
  stored on the account. The section the user is in the middle of editing stays open: the import
  review form, and the resume section being written. A new titled section on a page follows this
  rather than rendering fully open. A tab's main content is the exception: each job workspace
  tab (Fit, Resume, Study, Interview, Posting) stays open, and only long extras inside it, like
  the full job description, collapse.

- **File history in git**, not in file headers.

- **GraphQL subscriptions for live UI updates.** graphql-ruby subscriptions over ActionCable,
  using the Solid Cable adapter (Postgres-backed, so there's no Redis to run). The web app
  subscribes with Apollo over an ActionCable link. `/cable` authenticates the same
  cookie session as HTTP and rechecks it before private delivery and operations.

- **Per-service env files** (`services/api/.env`, `services/ai/.env`) for secrets. They match
  Kubernetes, where each deployment gets its own secrets. Local, non-secret wiring lives in
  `docker-compose.yml`.

- **AI worker reads the database directly with a read-only role** (`ai_reader`), so "Rails
  owns writes" is enforced by Postgres. Gap analysis reads the job and career library itself
  instead of Rails packing a snapshot into the task message (the library can outgrow a
  comfortable SQS payload, and the worker would need the same access for memory retrieval
  anyway). The role gets SELECT only on the tables it needs, and of `users` only `id`,
  `summary`, `screened_fields`, `name`, `contact_email`, and `phone`, so the sign-in email, password hashes, and
  tokens stay out of reach. Grants are applied by a Rails rake
  task after every `db:prepare` / `db:migrate` (`lib/ai_reader_access.rb`), because `schema.rb`
  doesn't record grants; a Postgres init script only creates the role. It can also read
  `library_embeddings` for memory search. Every worker query
  filters by the task's `user_id`, and all reads for one task run in one REPEATABLE READ
  transaction, so the job and library are a consistent snapshot.

- **Docker for everything.** Local dev runs through docker compose, and the same images
  deploy to Kubernetes. Application runtimes and dependencies stay in containers to keep
  dev and prod consistent.

- **Native Ubuntu development.** The host uses bash, Docker Engine, and the Docker Compose
  plugin. Keep the checkout on the local Linux filesystem for bind mounts and file-change
  events used by Rails and Vite. See the root README for setup commands.

- **Open: Kubernetes hosting cost.** EKS costs about $73/month for the control plane alone.
  Decide before the deploy phase whether to use EKS or a cheaper k8s setup.
