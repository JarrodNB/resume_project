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
     (the agent called the deferred `ask_user` tool; planned for career library rewriting,
     not used yet)
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
- `scrape_job`: input `{url}` (the canonical `https://www.linkedin.com/jobs/view/<id>/` form of
  the link the user pasted; `Jobs::StartJobScrapingService` only accepts LinkedIn job links for
  jobs the user hasn't saved yet). The completed result is
  `{scraped_job: ScrapedJobPosting}` (`services/ai/schemas/scraped_job_posting.py`: source,
  source_url, title, company, location, description, requirements, nice_to_haves,
  requirements_sorted_by, warnings). `ApplyAiResultService` saves it as a Job
  (`Jobs::CreateJobFromScrapedPostingService`, `url` = the canonical link) inside the same row lock,
  links it as the task's `subject` (GraphQL `AiTask.job`), and fails the task instead if the
  Job can't be saved. Usage is reported only when the sorting agent ran.
- `analyze_gaps`: input `{job_id}`; the task's `subject` is the Job. The worker reads the job
  and the user's career library itself (read-only `ai_reader` role, scoped by the message's
  `user_id`), so the input stays tiny and the analysis always uses the current library. The
  completed result is `{gap_analysis: GapAnalysisResult}` (`services/ai/schemas/gap_analysis.py`:
  summary, and per requirement and nice-to-have its kind, text, verdict `met` / `partial` /
  `missing`, explanation, and evidence entries `{kind, id, text, context}` copied from the
  library). Rails stores it on the AiTask only; `Job.latestGapAnalysis` is the newest one, and
  re-running creates a new task. A deleted job, an empty library, or a job without
  requirements fails the task with a user-facing message.

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
  throttling or 5xx, job site 429/5xx or network error; see `services/ai/worker/retryable_errors.py`) publishes nothing and keeps
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

User facts are stored as rows with embeddings in pgvector, so the AI service can retrieve the
ones relevant to a task (e.g. the library entries closest to each job requirement when
tailoring) instead of sending everything.

- **What's embedded:** every career library entry: experiences, highlights, projects,
  educations, and skills. Each is embedded as one text with enough context to stand alone
  ("Senior Engineer at Acme: Cut deploy time 40%"). Gap responses will be added once they exist.
- **Storage:** `library_embeddings` (`source_type` + `source_id`, `content`, `content_digest`,
  `model`, `embedding vector(1536)`), HNSW index with cosine distance, in the same Postgres.
- **Model:** OpenAI `text-embedding-3-small` at 1536 dimensions (Rails
  `CareerLibraryEmbeddings`, worker `embedding_model`; they must match).
- **Writing (Rails):** every service that changes library text enqueues
  `CareerLibrary::SyncLibraryEmbeddingsJob` (after commit). `SyncLibraryEmbeddingsService`
  holds a per-user advisory lock, embeds only entries whose SHA-256(model + text) changed, and
  deletes rows whose entry is gone, so running it twice is harmless and any run repairs drift.
  `bin/rails career_library:sync_embeddings` backfills all users (e.g. after a model change).
- **Reading (worker):** `memory/embed_search_query.py` embeds the query through Pydantic AI's
  `Embedder` (traced in Langfuse), and `database/library_embedding_search.py` searches as
  `ai_reader`, filtered by `user_id` and `model`, with HNSW iterative scans so the user filter
  doesn't cut results short. Tailoring will be the first caller.

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
- **Rails computes career library embeddings itself (an exception to "all LLM calls go through
  the AI service").** Embeddings are derived data that Rails can rebuild at any time, and they
  contain no prompt. They are also too large for the result queue: one 1536-dimension vector is
  roughly 8–20 KB as JSON, so a resume import's worth won't fit in a 256 KB SQS message. Two
  alternatives were rejected: letting the worker write embeddings through a second, narrow
  database role (weakens "Rails owns writes"), and returning smaller, packed vectors split
  across several result messages (more moving parts for no product gain). The cost is a few
  hundredths of a cent per library, so embeddings don't count toward the per-user AI budget,
  and Rails' embedding calls aren't traced in Langfuse. The sync runs as a background job, so
  an OpenAI outage never blocks an import or an edit. The worker still embeds search queries
  through Pydantic AI, so those calls are traced.
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
- **AI worker reads the database directly with a read-only role** (`ai_reader`), so "Rails
  owns writes" is enforced by Postgres. Gap analysis reads the job and career library itself
  instead of Rails packing a snapshot into the task message (the library can outgrow a
  comfortable SQS payload, and the worker would need the same access for memory retrieval
  anyway). The role gets SELECT only on the tables it needs, and of `users` only `id` and
  `summary`, so password hashes and tokens stay out of reach. Grants are applied by a Rails rake
  task after every `db:prepare` / `db:migrate` (`lib/ai_reader_access.rb`), because `schema.rb`
  doesn't record grants; a Postgres init script only creates the role. It can also read
  `library_embeddings` for memory search. Every worker query
  filters by the task's `user_id`, and all reads for one task run in one REPEATABLE READ
  transaction, so the job and library are a consistent snapshot.
- **Gap analysis speaks in short labels; code fills in the evidence.** The prompt labels each
  requirement (`R1`, `N1`) and library entry (`E1`, `H1`, `P1`, `ED1`, `S1`, `SUMMARY`), and the
  agent answers with labels only. An output validator sends missing, repeated, or unknown labels
  back as a retry, then code maps labels to ids and copies the library text as evidence. Short
  labels are cheaper and more reliable than UUIDs in a prompt, and the agent can't invent or
  reword evidence. It only compares the library with the job; it asks no questions.
- **Gaps are answered in the comparison view, not by an AI asking questions.** The user can
  write a response under any gap or partial match. Responses are saved in Rails per job and
  requirement (keyed by the requirement text, not the analysis run), so re-running the
  comparison keeps them, and each can optionally be added to the career library as a `LibraryFact`
  (the requirement plus the answer). Only that fact is embedded and read by later gap analysis;
  an answer left on the job is not. Tailoring
  reads the gap analysis and the responses as inputs. A deferred `ask_user` flow was considered
  and rejected here: the comparison already lists every gap, so a plain form is simpler, needs
  no paused agent runs, and lets the user decide what's worth answering. Human in the loop is
  kept for a later feature where the AI rewrites career library entries and must ask for facts.
- **AI tasks outlive their job.** `Job has_many :ai_tasks, dependent: :nullify`: deleting a job
  clears the tasks' subject but keeps them, so their cost still counts toward the monthly
  budget.
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
  planned for AI-assisted rewriting of career library entries. Partial dates ("2021") stay strings until import, where they
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
- **Job scraping is deterministic and per site; the LLM only sorts scraped bullets by number.**
  Each supported job site gets its own scraper (`services/ai/scrapers/`, one site at a time)
  that reads the site's own markup or data instead of handing a whole page to an LLM.
  Requirements and nice-to-haves come from the posting's own headings ("Requirements",
  "Preferred qualifications", ...). Only when no requirement heading matches does a small agent
  sort the posting's bullets, and it answers with bullet numbers, so every requirement is still
  the posting's exact wording and nothing can be invented. Unsupported sites fail fast in Rails,
  with no AI task.
- **LinkedIn is the first (and only) job site.** Sites must be where job seekers actually find
  jobs and copy links. Applicant tracking systems (Greenhouse, Lever, Ashby) were rejected: many
  companies embed them in career pages that open jobs in pop-ups, with no copyable posting link.
  Indeed, Glassdoor, and ZipRecruiter block plain HTTP requests. LinkedIn gives every job a
  link, and its signed-out guest job page
  (`/jobs-guest/jobs/api/jobPosting/<id>`) returns stable HTML without a login. LinkedIn's terms
  forbid scraping, so we only ever fetch the single job a user pasted (no crawling), and a page
  without a job title fails the task instead of saving an empty job.
- **Scraped jobs are saved without a review step.** Unlike a parsed resume, a scraped job
  changes nothing the user already has: it only adds a Job whose fields are copied from the
  posting. So Rails creates it as soon as the result arrives, and the web app opens it (after
  showing any scraper warnings, e.g. "AI sorted the requirements"). This is the exception to
  "AI results are reviewed before they change user data". Creating the Job inside
  `ApplyAiResultService`'s row lock keeps redelivered results from creating it twice.
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
