# AGENTS.md — services/ai/worker

## Purpose

The worker process: polls SQS, dispatches each task to the right handler, publishes results.

## Contents

- `job_preference_handler.py` — frozen owner criteria and searched-listing evidence, exact provenance reuse, bounded screening and new JEV fit decisions; no database writes.

- `result_delivery.py` owns queue publication and safe production failure diagnostics.
  It forwards delivery outcomes to the optional local transcript hook.

- `main.py` owns the narrow conversation lifecycle hook; `../llm/usage.py` delegates concrete
  request observation to the independent `conversation_logging/` package. Settings gate
  this filesystem logging on `WORKER_ENVIRONMENT=local` and allow an explicit opt-out.

- `main.py` — entry point and polling loop (`python -m worker.main`); `process_task_message`
  wraps each task in a Logfire trace and publishes the result before the task message may be
  deleted; `poll_until_stopped` logs and retries errors (5s pause) instead of exiting
- SIGTERM/SIGINT interrupt the current execution with `WorkerShutdown` (a `SystemExit`
  subclass so neither handler failure policies nor asyncio callbacks swallow it). Task
  contexts close and flush before process exit; interrupted messages are not acknowledged
  and SQS can redeliver them after
  visibility expires. Repeated stop signals do not interrupt cleanup. Local Compose allows
  30 seconds for shutdown. SIGKILL and native code that delays Python signal handling can
  still leave pending spans; flushing cannot close a span whose context never unwinds.
- `queue_messages.py` — Pydantic models for `ai_tasks` and `ai_results` messages (keep them in
  sync with `AiTasks::EnqueueAiTaskService` and `AiTasks::ApplyAiResultService` in Rails)
- `task_handlers.py` — `handle_ai_task`: dispatches by `task_type` (`TASK_HANDLERS`); types
  without a handler yet return a "not supported yet" failure
- `parse_resume_handler.py` — downloads the upload, extracts text, validates original limits,
  prepares local `pii/` masking before screening and parsing, restores structured output
  before source checks, and fails closed when privacy preparation/restoration fails;
  screens it (a block fails
  the import; an extract over the text or page cap fails as too long, not unsafe; a screen
  that does not run fails as unchecked, not unsafe; the phrase list is not applied to the
  whole file), runs the
  resume parsing agent, checks its output with `enforce_source_faithfulness`, reports parsing
  and Jev token usage.
  Local stage timings export through Logfire as static OpenTelemetry child spans:
  `resume_import.download`, `resume_import.extract`, `resume_import.prepare_pii`,
  and `resume_import.restore_and_check_source`. These spans carry no document attributes
  or exception details because failures may occur before contact detection. Existing
  instrumented agent spans time screening and parsing. Browser upload, Rails storage/enqueue,
  queue wait, and result delivery are outside these local worker timings.
- `parse_job_posting_handler.py` — screens a pasted ad, runs the parse agent, and returns a
  `ScrapedJobPosting` (description is the paste; title, supplied company, and bullets must appear
  in it; an unstated company is null)
- `scrape_job_handler.py` — picks the site's scraper for the URL, extracts the posting (sorting
  agent only when headings don't label requirements), reports usage only if the agent ran;
  unsupported URLs and missing postings fail with user-facing messages
- `analyze_gaps_handler.py` — reads the job and career library (scoped to the task's user),
  delegates required job and complete-library screening and prompt building to gap-analysis
  preparation, runs the gap analysis agent, attaches
  evidence text, and reports Jev usage; a deleted job, empty library, job without
  requirements, or prompt over the character cap fails with a user-facing message
- `tailor_resume_handler.py` — delegates one complete draft to the tailoring module and
  returns ordered sections and omission warnings. It copies no domain data back to the
  database and never pauses for section approval. Unexpected errors retain normal retries
- `retryable_errors.py` — `is_retryable_error`: temporary failures (rate limits, 5xx, network,
  incl. job site fetches through httpx and database connection errors) are left for SQS to redeliver; anything else, or the
  last attempt, publishes `failed`
- `product_name.py` — `PRODUCT_NAME` and the job-scraper `USER_AGENT` built from it
- `task_dependencies.py` — `TaskDependencies` (settings + file storage + `httpx.Client` for job
  sites + gap analysis context reader) passed to every handler; `build_http_client`
- `s3_file_storage.py` — read-only download from the uploads bucket (S3Mock locally)
- `contact_context.py` — loads the queue task's owned profile and tailoring snapshot,
  then enters shared `privacy/` masking; imports select the existing local PII session.
- `task_tracing.py` — adds queue task identity, contact-safe input and incomplete-cost
  state around shared `telemetry/` instrumentation and bounded final flushing.
- `settings.py` — `WorkerSettings` adds queue, storage, retry and local transcript options
  to the shared `AISettings` model/screening/read-only retrieval configuration.
- `sqs_queue_client.py` — wrapper for one SQS queue (receive, delete, send)

## Local Rules

- `../llm/usage.py` owns request-level accounting for one execution, independent of telemetry.
  Concrete generative/fallback and screening models use its adapter; query embeddings record
  their returned usage there. `main.py` publishes an unfinished usage marker before execution
  and a final report even when retrying. Never add handler aggregate usage to observed requests.

- `process_task_message` collects capability screening usage even when the guard blocks.
  `InputBlocked` publishes a failed task with the safe error message.
- Every execution starts a fresh screening session. Source-selection calls share decisions
  with exact bound prompts. Career-library fields reuse saved checks and report newly checked
  field names on final results. Saved Job fields similarly reuse checks and report typed-value
  fingerprints through `job_screening`. Saved gap-response requirement/body checks report
  through `gap_response_screening`. Written practice answer checks use `interview_question_screening`
  with exact fingerprints and question/answer revisions. They survive later generation failure; other inputs are
  screened again in later tasks. Standalone handlers
  and agent wrappers establish a local session when no worker execution exists.
- Keep this package about queue plumbing and dispatch. Agent logic goes in `agents/`,
  tools in `tools/`, prompts in `prompts/` (sibling folders).
- Handlers take `(task, dependencies)` and return an `AiResultMessage`. Return a `failed`
  result with a user-facing `error_message` for expected problems (e.g. unreadable file);
  let unexpected exceptions propagate (main publishes a generic failure, or the run-limit
  message when a request, tool-call, or token cap was hit).
- Completed results list a `ModelUsage` for every agent run (`build_model_usage`). The model
  name is the one that answered when that name has a price, otherwise the configured primary.
  A new model needs an entry in `MODEL_PRICES` (a test checks every configured model has one).

## Certification support

Certifications are separate career-library entries (`Certification`, labels `C1`), with
name, issuer, issued/expiry dates, credential ID/URL, and description. Older parsed
payloads may omit `certifications`. Tailored resumes use a separate Certifications section.


- `interview_questions_handler.py` — handles generation and regeneration from the current library with screened notes, limits, usage, and structured drafts. Rails-owned generated question text is trusted when reused as exclusions. Saved career context includes screened requirement context to clarify responses. Only responses receive evidence IDs or quote coverage; requirements cannot establish personal qualifications.
  Queue snapshots accept immutable general, technical, and knowledge scopes through the shared schema type.
  Replacement exclusions come from the Rails-owned question-set snapshot; legacy sibling
  metadata is retained for compatibility but is not needed to trust generated question text.

- `interview_feedback_handler.py` — reuses saved question/answer checks or screens pending
  answer checks before model use, trusts the Rails-owned generated question, screens library
  notes and career context requirement context, and reports coaching plus usage without writes.
  Requirement context clarifies a response but cannot support personal claims or evidence quotes.
  Knowledge snapshots allow corrected subject examples while preserving the original answer and source-only optional evidence.
- `model_inputs/interview_evidence.py` — readable career-library field projection and exact quote sources shared by question generation and feedback; `model_inputs/interview.py` owns their task-specific framing.

- `library_review_handler.py` — screens only unchecked fields of a Rails-owned selected-section
  snapshot (Summary, Experience, Projects, or Career context), renders plain labeled records, maps assessment labels back to target identities,
  and leaves all saved career facts unchanged. The whole section must fit the source cap.
- `library_edit_handler.py` — screens new feedback/answers, restores exact coverage for owned
  prior messages, and resumes Pydantic AI deferred questions. Generated history and proposals
  are not classified. A Rails-owned `review_question` adds generated guidance to a new
  answer task or a paired-answer batch and disables further deferred questions, including on
  linked retries. All answered fields are screened before a first/rebuilt batch prompt; generated
  questions are not. Saved history restores coverage so later feedback does not rescreen old pairs.
  Source/input/history/turn caps bound every exchange.

- Written question tasks accept `avoided_questions` and replacement questions as Rails-owned generated text. Reuse trusted-generated-source coverage for these exact task snapshot values, including legacy sibling strings without identity metadata; never screen our own generated questions or drop exclusions at the prompt cap.
  Full-set tasks also accept optional Rails-owned `recent_questions` as prompt-only variety
  guidance. Trust that generated text, keep it separate from exclusions/evidence, and never
  add overlap validation or retries.

- `study_guide_handler.py` — screens a frozen description and returns bounded guide material without reading career-library data or reusing saved-job approvals.

- `rerank_job_listings_handler.py` — optional loaded-listing reranking. Embeds the bounded
  Rails-owned excerpt batch once through Pydantic AI, reuses the owner/model-scoped
  stored library vectors through an injected scorer, and returns ranked IDs. No generative
  prompts or seniority inference. Embedding requests have deadline/request/token limits,
  known charges and incomplete-usage accounting; missing indexed evidence fails clearly.
- `interview_references_handler.py` claims one owned prompt before query embedding/search. Returns exact saved career references for the candidate UI, never interviewer context. Duplicate claims perform no paid work; failures use explicit bounded retry like clarification. Selection/projection lives in `interviews/references.py`.

- `interview_session_feedback_handler.py` — once-only completed-session claims, approved saved dialogue reuse, bounded coaching and usage through the results queue.

- `legacy_career_context.py` normalizes structural identifiers in task envelopes published
  before the database rename. User prose, history strings and source digests remain exact;
  ordinary handlers and schemas use only canonical career-context names.

- `summary_generation_handler.py` — frozen owned facts, exact saved screening reuse, batched unknown-field checks, readable prompts and cited proposals; no domain writes.

- `job_preference_conversation_handler.py` — bounded owner-frozen preference drafts and linked private history; screens only new/unknown text, uses deferred clarification, returns editable criteria without confirming them.
