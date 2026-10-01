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
  message_history, error_message}`, where `status` is `completed`, `needs_user_input`, or `failed`

Per task type:

- `parse_resume`: input `{source_file: {key, filename, content_type}}`, where `key` is the
  Active Storage blob key in the S3 uploads bucket. The completed result is
  `{parsed_resume: ParsedResume}` (`services/ai/schemas/parsed_resume.py`). The user reviews and
  edits it, then the `importParsedResume` mutation writes it to the career library and
  creates a base resume (once per task, tracked by `AiTask#accepted_at`).

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
- **Langfuse reading APIs:** new Langfuse Cloud organisations can only read data through
  `GET /api/public/v2/observations` and `GET /api/public/v3/scores`; the older trace and
  score endpoints return 410. Ingestion via OpenTelemetry is unaffected.
- **Open: Kubernetes hosting cost.** EKS costs about $73/month for the control plane alone.
  Decide before the deploy phase whether to use EKS or a cheaper k8s setup.
