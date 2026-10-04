# Architecture

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
                                    │   (Python    │──▶ Langfuse
                                    │   workers)   │
                                    └──────────────┘
 Lambda (scheduled) ──▶ daily goal emails, weekly summaries, periodic job searches
```

## AI Task Flow

1. The user triggers an action (e.g. "analyze this job against my resume").
2. Rails creates an `AiTask` record (`status: queued`) and publishes a message to `ai_tasks`.
3. An AI worker runs the matching Pydantic AI agent, traced in Langfuse.
4. The worker publishes to `ai_results` with one of:
   - `completed` + structured payload (the agent's Pydantic `output_type`)
   - `needs_user_input` + question(s) + serialized agent message history
     (the agent called the deferred `ask_user` tool)
   - `failed` + error
5. Rails consumes the result, updates the `AiTask` and related records (storing the message
   history on the `AiTask`), and pushes the update to the client through a GraphQL
   subscription (e.g. `aiTaskUpdated(id)`).
6. When the user answers, Rails publishes a follow-up task with the stored message history
   and the answers. The worker resumes the agent with `DeferredToolResults`.

## Queue Messages

Both are JSON. The Python side validates them with Pydantic (`services/ai/worker/queue_messages.py`).

- `ai_tasks` (published by `AiTasks::EnqueueAiTaskService`):
  `{ai_task_id, user_id, task_type, input}`
- `ai_results` (applied by `AiTasks::ApplyAiResultService`, via the Shoryuken `AiResultWorker`
  in the `api-results-worker` process): `{ai_task_id, status, result, pending_questions,
  message_history, error_message, usage}`, where `status` is `completed`, `needs_user_input`, or
  `failed`, and `usage` lists one `{model, input_tokens, cached_input_tokens, output_tokens,
  cost_microdollars}` entry per agent run (`input_tokens` includes the cached ones)

Per task type:

- `parse_resume`: input `{source_file: {key, filename, content_type}}`, where `key` is the
  Active Storage blob key in the S3 uploads bucket. The completed result is
  `{parsed_resume: ParsedResume}` (`services/ai/schemas/parsed_resume.py`). The user reviews and
  edits it, then the `importParsedResume` mutation writes it to the career library and
  fills blank profile fields on the user (contact details, summary). It creates no resume;
  resumes are only created when tailoring for a job. Each task imports once, tracked by
  `AiTask#accepted_at`.

The Python worker deletes a task message only after its result is published. Messages that
can't be parsed or applied stay on the queue and move to the `*_dead_letters` queue after 3
receives.

## Duplicate Messages

Standard SQS delivers each message *at least* once, so a task or result can occasionally
arrive twice (a worker crashes before deleting, a task outlives its visibility timeout, or a
rare SQS redelivery). We handle this instead of trying to prevent it:

- **Rails result handling is idempotent.** Every message carries the `ai_task_id`. Results for
  an `AiTask` that is already `completed` or `failed` are ignored. The check runs under a row
  lock, so two copies processed at the same moment can't both apply.
- **Workers receive one message at a time**, so no message sits in a local batch while its
  visibility timeout runs out. Scale by adding workers.
- **Long tasks extend their visibility timeout** (heartbeat) if real runs approach the
  300-second limit. Add this once actual task durations are known.
- FIFO queues are not used: their 5-minute deduplication window doesn't cover these cases
  and they reduce throughput.

A duplicate costs extra LLM spend at worst, never corrupt data.

## Retrying Temporary Failures

The worker retries through SQS redelivery instead of in-process loops:

- A **temporary** failure (model rate limit or 5xx, connection error or timeout, AWS
  throttling or 5xx; see `services/ai/worker/retryable_errors.py`) publishes nothing and keeps
  the message. The worker shortens its visibility to 30s × the attempt number, so the retry
  comes sooner than the 300-second timeout.
- A **permanent** failure (bad input, bug, missing upload, invalid model output) publishes
  `failed` right away.
- The **last attempt** (`ApproximateReceiveCount` = `MAX_TASK_ATTEMPTS`, default 3) publishes
  `failed` even for a temporary error, so the user sees a result before SQS dead-letters the
  message. `MAX_TASK_ATTEMPTS` must equal the `ai_tasks` dead-letter `maxReceiveCount`.

## Usage Limits

LLM calls cost money, so each user has limits, checked by `AiUsage::CheckAiTaskAllowanceService`
before a task is queued (under a lock on the user row, so concurrent requests can't both pass):

- **Monthly budget** (default $2.00, `AI_MONTHLY_BUDGET_USD`): the sum of `ai_tasks.cost_microdollars`
  for tasks created this calendar month (UTC). The worker estimates each run's cost from its
  token usage and a per-model price table (`services/ai/worker/model_prices.py`) and reports it
  with the result.
- **Tasks per hour** (default 10, `AI_TASKS_PER_HOUR`): tasks created in the last rolling hour.
- **Tasks in flight** (default 2, `AI_MAX_IN_FLIGHT_TASKS`): `queued` tasks from the last 15
  minutes (older ones are treated as stuck). Tasks waiting on the user's answer don't count.

Nullable columns on `users` override each default. `me { aiUsage }` exposes the month's spend.

Separately, Rack::Attack throttles requests (`config/initializers/rack_attack.rb`): sign-in by
IP and by email, sign-up by IP, and `/graphql` by user (JWT `sub`) and by IP. Throttled
requests get a JSON 429 with `Retry-After`.

## Memory

User facts (skills, accomplishments, answers to AI questions) are stored as rows with
embeddings in pgvector. The AI service retrieves relevant memories per task, so
information carries across conversations.

## Decisions

- **SQS over Sidekiq for AI work.** Both Rails and Python need to use the queue, and a
  managed queue decouples scaling of the AI workers. ElasticMQ (an SQS-compatible
  emulator) runs locally; LocalStack was dropped because it now requires an account token.
- **Shoryuken for SQS in Rails, in its own process.** Shoryuken publishes to `ai_tasks` and
  consumes `ai_results` (polling, threads, retries, and dead-lettering come built in). The
  consumer runs as a separate `api-results-worker` service (same image as the API), so it
  scales and restarts independently of Puma and maps to its own k8s Deployment later.
  Because subscription triggers come from that process, ActionCable uses Solid Cable in
  development too.
- **Plain Python workers, no FastAPI.** All communication is over SQS, so the AI service
  needs no HTTP layer. Trade-off: SQS can't stream LLM tokens to the browser. If live
  streaming is needed later (e.g. the gap analysis chat), add a small HTTP/WebSocket
  service at that point.
- **pgvector over a separate vector DB.** One database to run; enough for this scale.
- **Rails-owned auth** (Devise + JWT).
- **OpenAI** as the LLM provider.
- **Pydantic AI for all agent work.** It provides typed structured outputs, tools, and
  dependency injection, and switching LLM providers is a config change. Its deferred
  tools match our SQS pause/resume flow, and its OpenTelemetry instrumentation sends
  traces to Langfuse without a custom wrapper.
- **The career library is the base; there is no base resume.** Importing a resume fills the
  library and the user's profile (contact details, summary) instead of also creating a base
  resume. A copied base resume would drift from the library as soon as the library was edited
  or a second resume was imported. Resumes are snapshots by design, so they only exist when
  tailored to a job.
- **Keep the career library deduplicated: merge on import, plus manual merge and delete.**
  Importing a resume merges an incoming experience, project, or education into an existing
  entry that matches. Experiences match on company and title, projects on name, and educations
  on institution and degree. Text compares case-insensitively, and if both entries have start
  dates they must be equal. Merging only fills fields that are blank on the kept entry and adds
  highlights it doesn't have; it never overwrites. An experience's blank end date means
  "current", so it is never filled. Duplicates the import doesn't catch can be merged or
  deleted from the library page. Matching keys are deliberately narrow: a missed duplicate is
  one click to fix, but a wrong automatic merge silently loses an entry.
- **Roles, projects, and education are always listed by date; highlights and skills are
  arranged by dragging.** The API orders dated entries most recent first (ongoing first, then
  by end date, undated last; `MostRecentFirst` concern), so a later import can't leave a new
  role at the bottom and there is no manual order to maintain. Highlights can be dragged to a
  new place or into another role (useful when the parser or an earlier merge put a bullet
  under the wrong job), and skills within their category. In the import review this only
  changes the draft in the browser; on the library page each drop is saved right away with
  `reorderSkills` (the full ordered id list, so repeating it is harmless) or
  `moveExperienceHighlight` (moves the existing row, keeping its id, and renumbers both
  roles). The web app updates the Apollo cache before the server answers and refetches if the
  change is rejected. Uses `@dnd-kit/react`, which supports keyboard dragging.
- **File history in git**, not in file headers.
- **Evals for every agent.** Pydantic Evals defines the test cases and evaluators and runs
  them locally and in CI. Scores go to Langfuse for comparison across prompt and model
  versions. Faithfulness (no invented experience) is the top metric, because it's the
  product's core promise.
- **Langfuse Cloud (free tier) for now.** Self-hosting needs ClickHouse, Redis, and S3-compatible
  storage, which is too heavy for local dev. Revisit self-hosting (on the k8s cluster) if
  free-tier limits or data-privacy needs require it, since traces contain resume content.
- **GraphQL subscriptions for live UI updates.** graphql-ruby subscriptions over ActionCable,
  using the Solid Cable adapter (Postgres-backed, so there's no Redis to run). The web app
  subscribes with Apollo over an ActionCable link, passing the JWT as the `token` query
  param on `/cable` (browsers can't set headers on WebSockets).
- **Per-service env files** (`services/api/.env`, `services/ai/.env`) for secrets. They match
  Kubernetes, where each deployment gets its own secrets. Local, non-secret wiring lives in
  `docker-compose.yml`.
- **AI worker uses a read-only DB role** (`ai_reader`) for memory retrieval, so "Rails owns
  writes" is enforced by Postgres.
- **Docker for everything.** Local dev runs through docker compose, and the same images
  deploy to Kubernetes. This avoids Windows toolchain issues (especially for Ruby) and keeps
  dev and prod consistent.
- **On Windows, the repo lives in WSL2, not on `C:\`.** Bind mounts from the Windows
  filesystem were slow enough that Rails' per-request reload check took ~5s (a 20 ms GraphQL
  query took 6–12s end to end), and file-change events didn't reach containers, so Vite had to
  poll. From the WSL2 filesystem, both work natively.
- **Uploads go to S3; only the key goes over SQS.** SQS messages are capped at 256 KB, so
  Rails stores uploads with Active Storage (S3 service) and the worker downloads them by blob
  key, read-only. Locally the bucket is Adobe S3Mock (MinIO's community edition is archived,
  LocalStack needs an account token). Text extraction (pypdf, python-docx) happens in Python,
  next to the agents. The upload's type is detected from its bytes, not the client's claim.
- **AI results are reviewed before they change user data.** A parsed resume is stored on the
  `AiTask`; the user edits it and explicitly imports it. Imports append to the career library
  (skills are de-duplicated by name) and can't be repeated for the same task.
- **Resume parsing extracts, never rewrites.** Bullets are copied word for word and anything
  not stated stays null, so evals can check faithfulness deterministically (every extracted
  highlight, skill, and company must appear in the source text). Ambiguities go into
  `parsing_warnings` instead of questions to the user; the human-in-the-loop flow is
  showcased in gap analysis. Partial dates ("2021") stay strings until import, where they
  become the first day of the month or year.
  The rule is also enforced at runtime: after every parse, `enforce_source_faithfulness`
  (`services/ai/documents/`) removes highlights and skills that don't appear in the source text
  and only warns about unmatched company, title, project, and institution names, since dropping
  a whole entry over a name mismatch loses too much. Every finding goes into
  `parsing_warnings`, so the user sees it during review. A rule-based parser as the default
  (LLM as fallback) was considered and rejected: text extraction is already procedural, the
  remaining structuring step is where rule-based parsers fail silently on varied layouts
  (columns, heading names, date formats, entry boundaries), and the LLM parse costs well under
  a cent per resume.
- **Langfuse reading APIs:** new Langfuse Cloud organisations can only read data through
  `GET /api/public/v2/observations` and `GET /api/public/v3/scores`; the older trace and
  score endpoints return 410. Ingestion via OpenTelemetry is unaffected.
- **AI budget checked before queuing, recorded after.** A task's cost is only known once it
  finishes, so the check can't reserve an exact amount. The in-flight cap bounds the overshoot
  to a couple of tasks, which is simpler than estimating and reserving costs up front. Spend is
  summed from `ai_tasks` instead of kept in a counter, so it can't drift, and a redelivered
  result assigns (never adds) its usage. Costs are integer micro-dollars because one resume
  parse costs well under a cent. Usage from a crashed or timed-out run isn't reported; the
  hourly and in-flight caps limit that gap. The price table lives in the worker, which knows
  the models; a configured model without a price fails a test instead of counting as free.
- **Rack::Attack on Rails.cache for request throttling.** No Redis: the dev memory store and
  production Solid Cache are enough at this scale.
- **Open: Kubernetes hosting cost.** EKS costs about $73/month for the control plane alone.
  Decide before the deploy phase whether to use EKS or a cheaper k8s setup.
