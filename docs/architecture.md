# Architecture

Description: Service boundaries, AI queue contracts, persistence, and architectural decisions.

Index:
- Services
- Code navigation and dependency directions
- AI Task Flow and Queue Messages
- Interview Prep
- Duplicate Messages and Retrying Temporary Failures
- Usage Limits and Memory
- Decisions

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
the schemas. Other dependency directions above remain review rules, not automated checks.

Prefer cohesive modules with small public interfaces. Split by responsibility or distinct
dependencies rather than a fixed line limit. By default, give handwritten code files a short,
plain-English header explaining their job, place in the workflow, and important limits;
tiny, self-explanatory files and generated code can skip it. Keep useful contract comments
and model-facing tool descriptions; export indexes and comments repeating method names
add maintenance. Apply header improvements as files are meaningfully edited.
Nested `AGENTS.md` files are for additional local constraints, not exhaustive file inventories.
Domain-specific guides remain useful where they record ownership, retry, privacy, or UI rules.

## AI Task Flow

1. The user triggers an action (e.g. "analyze this job against my resume").
2. Rails creates an `AiTask` record (`status: queued`) and publishes a message to `ai_tasks`.
3. An AI worker runs the matching Pydantic AI agent, traced in Logfire.
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
  message_history, error_message, usage, attempt_id, attempt_finished, usage_incomplete}`.
  `status` is `completed`, `needs_user_input`, `failed`, or `usage` (accounting only).
  `usage` lists `{model, input_tokens, cached_input_tokens, output_tokens, cost_microdollars}`
  per received provider response (`input_tokens` includes cached tokens; unknown prices are
  null). Each actual execution gets a fresh UUID, independent of SQS receive count and
  tailoring generation. The worker publishes an unfinished, incomplete usage marker before
  execution and one final accounting report with its result, or usage-only before retrying.
  Rails resolves each marker once; duplicate/out-of-order markers cannot overwrite a final
  report. Usage-only messages never change task status. A missing final report remains unknown.

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
- `parse_job_posting`: input `{text}` (the pasted advertisement, stripped, at most 20,000
  characters; `Jobs::StartJobPostingParseService` rejects a blank or longer paste). The worker
  screens the text with Jev, then a Pydantic AI agent copies the title, company, optional
  location and link, and requirement lines. Title, company, and every bullet must appear in the
  paste; location or a link that does not is dropped with a warning. The description saved on
  the job is the paste itself. The completed result is `{scraped_job: ScrapedJobPosting}` with
  `source` `pasted_text`. `ApplyAiResultService` saves it
  (`Jobs::CreateJobFromPastedPostingService`; `url` is the posting's `source_url`, or nil) inside
  the same row lock, links it as the task's `subject`, and fails the task instead if the Job
  can't be saved. A blank url is not matched against other jobs that have no link.
- `analyze_gaps`: input `{job_id}`; the task's `subject` is the Job. The worker reads the job
  and the user's career library itself (read-only `ai_reader` role, scoped by the message's
  `user_id`), so the input stays tiny and the analysis always uses the current library. The
  completed result is `{gap_analysis: GapAnalysisResult}` (`services/ai/schemas/gap_analysis.py`:
  summary, and per requirement and nice-to-have its kind, text, verdict `met` / `partial` /
  `missing`, explanation, and evidence entries `{kind, id, text, context}` copied from the
  library). Rails stores it on the AiTask only; `Job.latestGapAnalysis` is the newest one, and
  re-running creates a new task. A deleted job, an empty library, or a job without
  requirements fails the task with a user-facing message.

- `generate_interview_questions`: input `{question_set_id, set_number, set_type}`; the subject is an
  empty `InterviewQuestionSet`. The worker reads the current owned career library and returns
  `{interview_questions: {questions: [...]}, warnings: [...]}` with exactly five drafts.
  Each draft has `question_text`, `category`, and `evidence_quotes`; categories are
  `introduction`, `strengths`, `development`, `goals`, and `behavioral` for general sets,
  or `work_overview`, `tools_methods`, `decisions_tradeoffs`, `problem_solving`, and
  `improvement_quality` for technical sets; or `concepts`, `mechanisms`, `application`,
  `reasoning`, and `limitations` for knowledge sets, one of each. Knowledge excerpts ground
  topic relevance, while model subject knowledge supplies subject questions.
- `regenerate_interview_question`: input `{question_set_id, question_id, question_text,
  answer_text, question_revision, answer_revision, other_questions, set_type}`; the subject is the
  selected `InterviewQuestion`. `other_questions` contains the other four saved questions.
  The worker uses the current library and returns the same question result shape with one
  draft, excluding both the old question and the other four.
- `review_interview_answer`: input `{question_set_id, question_id, question_text, answer_text,
  question_revision, answer_revision, set_type}`; the subject is the selected `InterviewQuestion`.
  The result is `{interview_feedback: {strengths, improvements, example_answer,
  evidence_quotes}, warnings: [...]}`. Strengths and improvements are lists of coaching
  statements; personal examples use square-bracket placeholders for missing facts. Knowledge
  examples correct subject misconceptions using model knowledge without invented personal
  experience. Feedback has no score and never overwrites the answer.

The Python worker deletes a task message only after its result is published. Messages that
can't be parsed or applied stay on the queue and move to the `*_dead_letters` queue after 3
receives.

## Interview Prep

Rails owns `interview_question_sets` and `interview_questions`; the Python worker returns
drafts without writing domain data. Sets belong to a user and have a unique per-user number
and immutable `set_type` (`general`, `technical`, or `knowledge`, defaulting to general for legacy data).
Allocation runs under the user lock and considers retained generation task inputs, so deleting
a set does not reuse its number. Sets can be empty while generation is pending or failed.
Successful generation validates all drafts and creates positions 1–5 atomically. Only question
text is persisted on the slots; categories and evidence remain in the AI task result.

Questions store the user-written `answer_text`, `question_revision`, `answer_revision`, latest
feedback JSON, and the question/answer revisions that feedback reviewed. Explicit saves allow
an empty answer and increment the answer revision only when text changes. The answer limit is
10,000 characters, defined in Rails `config/initializers/text_limits.rb`, Python `text_limits.py`,
and web `src/lib/textLimits.ts`. Answers never become career-library entries. Deleting a set
cascades its questions and nullifies AI task subjects, retaining usage records and task inputs.

`InterviewPrep` services own generation, saving, replacement, feedback, and deletion. GraphQL
exposes owned `interviewQuestionSets` / `interviewQuestionSet(id)` queries and the mutations
`generateInterviewQuestionSet(input: {setType: GENERAL | TECHNICAL | KNOWLEDGE})`, `saveInterviewAnswer`, `regenerateInterviewQuestion`,
`requestInterviewAnswerFeedback`, and `deleteInterviewQuestionSet`. Question mutations scope
`questionId` through the owned `questionSetId`. AI work uses the shared usage allowance checks.
Feedback requires a nonblank answer and saves it before allowance checks or queue publication;
screening, budget, or queue failure therefore preserves a valid submitted answer.

Enqueue preparation, answer saving, deletion, and result application serialize on the owner
lock. Result application takes the owner lock before the task lock. Only one queued replacement
or feedback operation may run per question; replacement blocks answer saving, while pending
feedback permits edits. Replacing an answered question requires `confirmed: true`.

Result services check ownership, subject/set/question identity, latest task identity, and
snapshot revisions before writing. Replacement requires unchanged question and answer
revisions and checks distinctness against the current set, including the old question. On
success it increments both revisions and clears only that slot's answer and feedback; on
failure it preserves the old content. Feedback requires an unchanged question and the latest
feedback task, but accepts a newer answer revision: coaching is stored against the reviewed
revisions, so GraphQL `feedbackOutdated` marks substantive edits outdated. Capitalization and
whitespace changes remain current when a completed task's matching feedback and reviewed
answer snapshot verify that only formatting changed. Exact revisions still advance on saves.
Generated feedback never writes
the answer. Deleted, superseded, or invalid targets fail cleanly. The finished-task guard
prevents duplicate result persistence and usage accounting; failed application still retains
reported usage once.

Question generation requires usable library content; feedback can use an empty library. Both
handlers screen saved library-fact responses and omit job-derived requirement fields from
prompts and grounding evidence. Feedback also screens the submitted answer and fails closed
on rejection or screening unavailability. Existing contact masking, prompt limits, bounded
Pydantic AI runs, versioned prompts, and Logfire tracing apply. Question evidence requires
exact library excerpts; optional feedback excerpts are normalized to exact source text and
invalid excerpts discarded. Feedback validates nonblank prose and at most two placeholders;
personal-fact grounding and knowledge correctness still
requires quality evaluations. Run both interview eval runners after prompt/model/agent changes
(commands in `services/ai/evals/AGENTS.md`); finite, stochastic passes are not a universal
grounding guarantee.

Knowledge sets test understanding of subjects explicitly relevant to the career library in
every occupation, including sparse skills-only backgrounds. Five categories cover concepts,
mechanisms, application, reasoning, and limitations. Clearly hypothetical examples can test
application without asserting personal experience. Replacements retain this subject scope
and exclude the intents of all five existing questions. The library selects topics rather
than serving as an answer key. Knowledge coaching identifies factual errors, omissions and
reasoning gaps, then provides a concise corrected illustrative subject answer using model
knowledge. It must never invent personal experience. General and technical feedback continue
to use only supplied personal facts, with placeholders where needed. Synthetic evals include
nontechnology topics and incorrect answers, with a dedicated knowledge-accuracy judge and
scope-aware grounding rubric. There is no external knowledge ingestion, grading, code
execution, saved-job targeting, or answer-to-library persistence.
Trusted per-run scope selects separate knowledge-feedback instructions, so knowledge calls
never receive personal-fact-only scaffolding rules. The subject-accuracy judge deterministically
skips other scopes; its aggregate measures knowledge cases only.

The web routes `/interview-prep` and `/interview-prep/:id` list numbered/date sets newest first
and display five ordered cards. Persisted `latestTask` fields restore subscriptions on reload.
Cards preserve local drafts, show outdated feedback for substantive unsaved changes too, warn before
navigation with unsaved answers, and keep replacement controls locked until the new question
revision is fetched. Set deletion is confirmed; feedback/examples remain beside the answer.

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
  for tasks created this calendar month (UTC). The worker estimates each request's cost from its
  token usage and a per-model price table (`services/ai/worker/model_prices.py`) and reports it
  with attempt reports, including unsuccessful attempts. Missing provider usage or prices
  makes accounting incomplete; unknown costs do not block tasks below their known-spend budget.
- **Tasks per hour** (default 10, `AI_TASKS_PER_HOUR`): tasks created in the last rolling hour.
- **Tasks in flight** (default 2, `AI_MAX_IN_FLIGHT_TASKS`): `queued` tasks from the last 15
  minutes (older ones are treated as stuck). Tasks waiting on the user's answer don't count.

Nullable columns on `users` override each default. The existing `me { aiUsage }` query exposes
known monthly spend. The backend monthly summary also retains the incomplete-attempt count;
no new user-facing spend display or usage subscription is added.

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
  `Embedder` (traced in Logfire). `database/library_embedding_search.py` loads that user's
  rows for the stored model in cosine order (HNSW iterative scans, so the user filter does
  not drop a row). `memory/hybrid_rank.py` then fuses that order with BM25 over the same
  texts (reciprocal rank fusion, k=60). Tailoring queries it once per written section.

## Decisions

- **Interview sets have an immutable general, technical, or knowledge scope.** Existing sets and older
  queue snapshots default to general. Technical practice discusses actual role-specific work,
  methods/tools, decisions/tradeoffs, problem solving, and improvement/quality for every
  occupation, rather than knowledge quizzes, coding or hypothetical design exercises.
  Sparse skills, education, and nontechnology backgrounds receive best-effort questions
  grounded in available library evidence; only the existing empty/unusable-library check
  blocks generation. Generation, replacement, and feedback snapshot the type, and result
  application rejects mismatched snapshots. Feedback remains illustrative coaching and
  never replaces the saved answer. Knowledge practice tests career-relevant subject matter
  in all occupations; library excerpts select topics while model subject knowledge supplies
  corrections. Keeping personal-fact grounding distinct from subject correctness lets the
  coach correct wrong answers without fictional experience. No type targets a saved job.

- **Interview practice is persistent and independent of the library.** Existing questions
  stay fixed when career details change; new generation uses the current library. Multiple
  numbered/date sets support repeated practice without custom names or archived question
  history. Each set has five distinct English questions within its selected scope;
  job-specific generation remains future work.
- **Interview feedback coaches the user's answer.** It never fills or replaces the answer
  field and uses placeholders for missing personal facts in general/technical examples.
  Knowledge examples can correct subject facts without placeholders. Excluding job-derived requirements avoids
  treating an employer's expectations as the user's experience. Revision-bound feedback
  allows editing during AI work while making delayed coaching visibly outdated.
- **Feedback freshness ignores capitalization and whitespace.** Revision changes still track
  exact saved edits, but harmless formatting should not force another AI review. Completed
  task snapshots verify saved-answer equivalence; missing or mismatched evidence stays outdated.
- **One successful feedback request per saved version.** Feedback enqueueing checks completed
  task history for the question/answer revision pair under the owner lock. Queued requests
  already prevent overlapping operations; failures can be retried. Saving changed text or
  replacing a question creates a new version. The web button uses persisted feedback revisions
  to remain disabled after success and reload.
- **Interview replacement preserves content until success.** Task identity, revisions, and
  owner-before-task locking prevent obsolete or concurrent results from overwriting newer
  work. Atomic five-slot creation and single-slot replacement avoid partially populated sets
  or clearing unrelated answers. Confirmation protects an answered slot from accidental loss.

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
- **Library search is hybrid.** Cosine order from pgvector is fused with BM25 over the same
  user's embedding texts by reciprocal rank fusion, k=60. Cosine alone misses a row that uses
  the job's exact wording when a semantically nearby row ranks first. BM25 drops English
  stopwords and does not stem; the embedding already covers inflection and synonyms. k=60
  (checked on the golden disagreement case in `tests/test_hybrid_rank.py`) prefers a row that
  both lists rank well over a row that is first on only one. Ties break toward the smaller
  cosine distance. The user and model filters run in SQL before either rank. The
  library-retrieval eval calls the same fusion and reports recall@k, precision@k, and MRR.
- **Rails computes career-library and saved interview Q&A embeddings itself (an exception to "all LLM calls go through
  the AI service").** Embeddings are derived data that Rails can rebuild at any time, and they
  contain no prompt. They are also too large for the result queue: one 1536-dimension vector is
  roughly 8–20 KB as JSON, so a resume import's worth won't fit in a 256 KB SQS message. Two
  alternatives were rejected: letting the worker write embeddings through a second, narrow
  database role (weakens "Rails owns writes"), and returning smaller, packed vectors split
  across several result messages (more moving parts for no product gain). The cost is a few
  hundredths of a cent per library, so embeddings don't count toward the per-user AI budget,
  and Rails' embedding calls aren't traced in Logfire. The sync runs as a background job, so
  an OpenAI outage never blocks an import or an edit. The worker still embeds search queries
  through Pydantic AI, so those calls are traced.
- **Interview Q&A vectors remain separate from career-library evidence.** Future successful
  nonblank answer saves (including unchanged saves and feedback saves) enqueue a question-specific
  `InterviewPrep::SyncQuestionEmbeddingJob` after commit. `interview_question_embeddings` stores
  original combined Q&A, a model/masked-text digest, source revisions, and a 1536-dimension vector.
  Contact is masked only for the provider. A unique question foreign key cascades deletion;
  edits/clears and successful replacements invalidate vectors in the source transaction.
  The service snapshots and rechecks ownership, content, and revisions under the owner lock,
  releasing it during HTTP. A question advisory lock serializes duplicate jobs. Late results
  cannot restore obsolete content. There is no backfill, search index/interface, library
  promotion, or AI-reader grant. Temporary errors retry; missing configuration logs and skips.
  These independent Rails calls incur provider costs outside AI-task budgets/attempt reports
  and Logfire tracing, like library syncs; feedback tasks do not absorb their costs.
- **Rails-owned auth** (Devise + JWT).
- **OpenAI** as the LLM provider. Generative agents (parsing, sorting, gap analysis, tailoring)
  call `gpt-5-mini` and fall back to `gpt-5-nano` on a rate limit, 5xx, or connection error.
  A failed output check retries the same model. Jev stays a single pinned model and fails closed.
- **Prompt versions are stamped on traces.** Each prompt module has a version constant. The
  agent run records it on the Logfire spans for that call, so a task that screens text and
  then generates still shows which prompt produced which call. `LOGFIRE_ENVIRONMENT`
  labels the trace with the environment.
- **An agent run stops at a modest cap, and the task fails.** Each run allows 6 model requests
  (the first answer, two output-validator retries, and the same three after a switch to the
  fallback model), no tool calls, 64,000 output tokens, and 128,000 total tokens. The library
  default of 50 requests is a loop these agents never need. There are no tools yet, so a tool
  call fails the run until one is registered and the cap is raised. Reasoning tokens count as
  output. The token caps are checked after the response, so one over-limit response is billed
  once and the task is not retried. A hit raises `UsageLimitExceeded`. The worker publishes
  `failed` on the first attempt, with no partial resume, analysis, or section. A wall-clock
  timeout stays retryable, because the same run may finish next time. A cap on the Jev screen
  fails the task the same way; a Jev outage still omits the text.
- **Pydantic AI for all agent work.** It provides typed structured outputs, tools, and
  dependency injection, and switching LLM providers is a config change. Its deferred
  tools match our SQS pause/resume flow, and its OpenTelemetry instrumentation sends
  traces to Logfire without a custom wrapper.
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
- **Page sections are collapsible and start collapsed.** Long pages are a stack of titled
  sections (the career library, a job, a tailored resume). Each starts collapsed and stays that
  way until the user opens it. The browser remembers the open ones in localStorage
  (`careergrind.openSections`), the same way it remembers the color theme, so the choice is not
  stored on the account. The section the user is in the middle of editing stays open: the import
  review form, and the resume section being written. A new titled section on a page follows this
  rather than rendering fully open.
- **File history in git**, not in file headers.
- **Evals for every agent.** Pydantic Evals defines the test cases and evaluators and runs
  them locally and in CI. Scores go to Logfire for comparison across prompt and model
  versions. Faithfulness (no invented experience) is the top metric, because it's the
  product's core promise.
- **Logfire telemetry configured through environment variables.** `LOGFIRE_TOKEN` enables
  remote export; without a token the worker and evals run without remote tracing or login.
  `LOGFIRE_ENVIRONMENT` labels environments. Each task and eval run flushes in a `finally`
  block with a five-second total caller wait. One daemon flush runs at a time, with no
  queued attempts if an exporter stalls. Known contact is captured at span creation and masked
  synchronously before export, including attributes, events, exception text, and status.
  Model requests and search queries use contact placeholders; application responses restore
  contact values. Other resume content can still leave the app when remote export is enabled.
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
  anyway). The role gets SELECT only on the tables it needs, and of `users` only `id`,
  `summary`, `name`, `contact_email`, and `phone`, so the sign-in email, password hashes, and
  tokens stay out of reach. Grants are applied by a Rails rake
  task after every `db:prepare` / `db:migrate` (`lib/ai_reader_access.rb`), because `schema.rb`
  doesn't record grants; a Postgres init script only creates the role. It can also read
  `library_embeddings` for memory search. Every worker query
  filters by the task's `user_id`, and all reads for one task run in one REPEATABLE READ
  transaction, so the job and library are a consistent snapshot.
- **Gap analysis speaks in short labels; code fills in the evidence.** The prompt labels each
  requirement (`R1`, `N1`) and library entry (`E1`, `H1`, `P1`, `ED1`, `S1`, `F1`), and the
  agent answers with labels only. The profile summary is shown as unlabeled background for the
  overall writeup and is not evidence, so it cannot be pasted under each requirement. An output
  validator sends missing, repeated, or unknown labels
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
  no paused agent runs, and lets the user decide what's worth answering. `ask_user` stays
  reserved for a later feature where the AI rewrites career library entries and must ask for facts.
- **User-written text is screened before it enters a prompt.** A small Jev decision model
  (`typesafe:jev-1.13.0`, TypeSafe) answers two yes/no questions: does the text try to override,
  reveal, or ignore instructions, and does it ask for actionable help with harm, crime, or
  abuse. Ordinary career history is not harmful. Code blocks when either answer's yes-confidence
  is at least 0.7. Jev does not choose allow or block, and there is no generative fallback. A
  missing `TYPESAFE_API_KEY` or a Jev error omits the text (fail closed) and does not send it.
  A short phrase check blocks obvious instruction-override wording without a model call. The
  screening unit is a cohesive untrusted source item: document, job context, library entry,
  gap response, submitted answer, approved section, or reused interview question. Each is
  checked once per execution. A blocked or unchecked optional entry is left out with a
  warning; a required input prevents generation. Imported, manually edited, retrieved, and
  scraped content follow this same rule when used in a generative request.
  Large sources use overlapping chunks with 300 characters of overlap. The 2,000- and
  4,000-character candidates are compared live against whole-resume screening before
  choosing the production size. Boundary overlap is intentional repeated text, not a
  second screening pass. All chunks must pass; a late rejection discards the entire item.
  Trusted builders bind exact assembled prompts to screened sources. Every generative
  agent retains an official input capability: it checks unknown direct input and user/tool
  history without screening an already covered prompt again. Coverage never uses substring
  removal or a caller boolean. Output-validation retries and provider fallback reuse the
  execution's coverage; later deliveries and tasks start fresh. No approval is stored in
  Rails or the queues. Text over a shared character cap is rejected before
  it is stored and again before a Jev or generative call (`TextLimits` in Rails,
  `services/ai/text_limits.py` in the worker): a resume extract over 80,000 characters or 30
  PDF pages, one screened string over 80,000 characters, or an assembled prompt over 120,000
  characters. Those failures tell the user the text is too long. They are not reported as
  unsafe, and rows are not silently truncated. A posting with too many bullets to sort is
  still saved, with a warning to add requirements by hand. A request body over 8 MB is a
  JSON 413. Jev usage is reported on the task result and counts
  toward the monthly budget. Token rates are TypeSafe's published $0.042 per 1M input tokens
  (output free), from https://docs.typesafe.ai/models (checked 2026-10-05).
- **Tailoring pauses once per section, in code, not via `ask_user`.** Contact is copied from
  the user profile with no model call. Rails snapshots contact, the gap analysis, and gap
  responses into the task input. The worker reads `name`, `contact_email`, and `phone` and
  replaces those known values with placeholders before a model call or a Logfire trace. Then one
  agent run writes summary, experience, projects, education, and skills, in that order. The model selects,
  orders, and rewrites toward the job, and must not invent employers, titles, tools, dates,
  metrics, or responsibilities. Each bullet cites library, gap-response, or approved-section
  labels; a checker rejects unsupported claims and does not replace the rewrite with the
  original library text. The agent may say nothing in the library fits; the user can leave that
  section out or ask for a draft anyway, still only from the library. Each written section
  retrieves library rows from that section's job requirements. The same `AiTask` is requeued
  per section. `generation` on the task and on the result lets `ApplyAiResultService` ignore a
  redelivered earlier `needs_user_input`, so it cannot rewind the draft. `needs_user_input` is
  not finished and does not count as in-flight. Gap-response bodies and the user's submitted
  section text go through the same Jev screen before the next prompt. A blocked section edit
  is rejected and the section stays open (the writer is not called). A blocked gap response is
  omitted with a warning. After the last section the task completes with the draft on the task.
  Save creates `Resume` and `ResumeSection` snapshots once (`accepted_at`). Deleting the job
  keeps the resume.
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
- **AI budget uses known costs, including unsuccessful attempts.** The worker collects
  screening, generation and query-embedding responses at their request seam, before output
  validation, run limits or later failures can discard usage. Each concrete fallback model
  is observed separately. Accounting does not depend on telemetry export. Costs use the
  worker's local price table and integer micro-dollars; provider charges without usage or
  pricing stay unknown rather than being estimated as zero. An unfinished report is sent
  before execution, so a stopped worker or failed final publication leaves an unknown marker.
  Exact charges for such attempts require provider reconciliation, which is not automated.
  `ai_usage_attempts` records each execution independently of task outcome and generation.
  Under the task lock, final reports add known totals once, including retries and late or
  stale-generation reports. Finished tasks keep their outcome. Legacy messages without an
  attempt identity retain the previous assignment/generation rules. Monthly totals still use
  tasks created in the UTC calendar month; unknown costs flag incomplete accounting and do
  not independently block work. The existing hourly and in-flight caps remain in place.
  Deploy the Rails migration/consumer before the new worker message format. This accounting
  covers queued AI tasks and their query embeddings; independent Rails career-library/interview Q&A
  embedding syncs and paid eval runs retain their separate existing execution paths.
- **Rack::Attack on Rails.cache for request throttling.** No Redis: the dev memory store and
  production Solid Cache are enough at this scale.
- **Open: Kubernetes hosting cost.** EKS costs about $73/month for the control plane alone.
  Decide before the deploy phase whether to use EKS or a cheaper k8s setup.
