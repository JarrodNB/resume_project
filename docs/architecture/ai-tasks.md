# AI tasks

Task execution and the contracts between Rails and Python workers.

[Architecture overview](../architecture.md) · [AI tasks](ai-tasks.md) · [Interview prep](interview-prep.md) · [AI safety and usage](ai-safety-and-usage.md) · [Career library](career-library.md)

## AI Task Flow

1. The user triggers an action (e.g. "analyze this job against my resume").
2. Rails creates an `AiTask` record (`status: queued`) and publishes a message to `ai_tasks`. The task is saved with `awaiting_queue_publish: true`,
   cleared once the message is sent. A minutely Rails job (`AiTasks::RepublishUnpublishedTasksJob`)
   re-sends tasks still marked after a minute (a crash between save and send), and fails them
   after 15 minutes. A duplicate send is safe (see Duplicate Messages).
3. An AI worker runs the matching Pydantic AI agent, traced in Logfire.
4. The worker publishes to `ai_results` with one of:
   - `completed` + structured payload (the agent's Pydantic `output_type`)
   - `needs_user_input` + question(s) + serialized agent message history
     (the agent called the deferred `ask_user` tool; used by individual career-library editing)
   - `failed` + error
5. Rails consumes the result, updates the `AiTask` and related records (storing the message
   history on the `AiTask`), and pushes the update to the client through a GraphQL
   subscription (e.g. `aiTaskUpdated(id)`).
6. When the user answers, Rails publishes a distinct follow-up task with the owned stored
   message history and newest answer. The worker resumes with `DeferredToolResults`.

Missing-summary generation uses `generate_summary`. The user explicitly requests a profile
or saved-resume summary; Rails freezes owned labeled career fields under its enqueue owner lock and stores
a substantive source digest. Career-context requirements are context, not qualification
evidence, so only responses are supplied. Before any provider call, the worker checks the
fully rendered, privacy-masked generation prompt against the 120,000-character prompt cap.
Each library source carries its record id; the label names the record type and field. Ids
stay out of the digest and the 180,000-byte input cap (1000 ids still fit one SQS message). Unknown
fields go through the shared `screen_records` batching within the existing 80,000-character
per-call cap, counting privacy expansion. A later batch rejection or outage prevents
generation and retains usage from all attempted batches. Length failures are reported as
limits rather than unsafe content. The worker reuses exact saved approvals, renders readable
source blocks, and returns cited text as a proposal. New library checks come back as
`record_screening` receipts; Rails saves one only when its fingerprint matches both the
frozen snapshot value and the live value, so changed live fields are never approved.
Saved-resume copies have no record id and are never approved. Generation does not write
profile or resume text.
Saved-resume evidence comes only from its own non-contact, non-summary career sections,
independent of the current library and any deleted job. Only exact generated highlights
and project prose in owned accepted tailoring results skip screening; copied fields and
unknown or edited text remain subject to screening. SQL selects matching generated values
without loading historical task bodies into application memory.

`summaryGeneration` restores the latest task and freshness. Start reuses matching pending
work or unaccepted proposals; failed/discarded/stale work can start anew. Accept/discard are
explicit owned mutations. Acceptance locks owner, source rows, then task, requires the latest
valid completed proposal and unchanged evidence with a still-empty summary, and is replay-safe.
For saved resumes the lock order is owner, resume, source sections, task. Resume edits and
deletion use the same owner-first serialization. Acceptance reuses a blank summary section
or inserts one after contact while preserving section order and inclusion. The editor
reconciles refreshed sections by ID so an insertion cannot shift unsaved edits onto another
section. Generation and acceptance pause while the resume has unsaved changes, is saving,
is being deleted, or is exporting; queued proposal completion never replaces those edits.
The accepted text may be edited during review; only exact unmodified generated text earns
screening provenance. Inclusion preferences do not change source freshness and are never
changed by generation or acceptance. Existing task allowance, post-commit queue publication,
subscriptions, terminal-result fencing and independently deduplicated late usage apply.

Individual library editing uses `improve_library_entry`. Input captures one owned summary, role description/highlight, project description, or fact-response target,
its role context and digest, feedback, root/previous task IDs, turn, and private saved history.
The browser sends only target/previous IDs and new feedback or a skip; it cannot supply history.
Results are either one pending question plus history, or `{text, color, reason}` plus history.
Rails validates bounded output; accepting updates only the exact target when source/context
still match, marks `accepted_at`, and adds an assessment for the accepted content digest.
Completed/paused editing tasks cannot be reopened or replaced by late results; follow-ups
get their own IDs and normal usage accounting. Exchanges allow at most eight turns and
180,000 input bytes; saved history is capped at 100,000 bytes. Other task contracts are unchanged.

## Queue Messages

Both are JSON. The Python side validates them with Pydantic (`services/ai/worker/queue_messages.py`).

- `ai_tasks` (published by `AiTasks::EnqueueAiTaskService`):
  `{ai_task_id, user_id, task_type, input}`
- `ai_results` (applied by `AiTasks::ApplyAiResultService`, via the Shoryuken `AiResultWorker`
  in the `api-results-worker` process): `{ai_task_id, status, result, pending_questions,
  message_history, error_message, usage, attempt_id, attempt_finished, usage_incomplete, record_screening}`.
  `status` is `completed`, `needs_user_input`, `failed`, or `usage` (accounting only).
  `usage` lists `{model, input_tokens, cached_input_tokens, output_tokens, cost_microdollars}`,
  with additive `cache_write_tokens` and optional `provider_response_id` for current workers,
  per received provider response (`input_tokens` includes cached tokens; unknown prices are
  null). Each actual execution gets a fresh UUID, independent of SQS receive count.
  The worker publishes an unfinished, incomplete usage marker before
  execution and one final accounting report with its result, or usage-only before retrying.
  Rails resolves each marker once; duplicate/out-of-order markers cannot overwrite a final
  report. Usage-only messages never change task status. A missing final report remains unknown.
  Final completed/failed results may include `record_screening`, one receipt per saved
  record: `{record_type, record_id, fingerprints: {field_name: sha256}, revision?}`
  (`revision` holds `question_revision`/`answer_revision` for interview questions).
  `Screening::RecordApprovalsService` handles career library, jobs, gap responses,
  written interview answers, preference criteria and catalogue listing passages. Every
  field needs a SHA-256 of its exact typed value encoded with compact UTF-8 JSON
  (Ruby `JSON.generate`, Python `ensure_ascii=False`, compact separators). Rails checks
  the current value under a row lock and the frozen task value where applicable.
  Unknown types, foreign rows, stale or missing fingerprints and malformed receipts are ignored.
  Summary and library review/edit receipts must match their frozen source snapshots.
  Successful checks survive later generation failure; usage-only and finished-task
  redelivery cannot restore an edited field's approval. All result writes lock the owner
  before the task and domain rows. Text edits reload under their row lock and use the
  `ScreenedFields` concern to clear only changed field checks atomically with saving.

  Jobs use ordered list fingerprints for requirements and nice-to-haves. Gap responses
  must belong to the task's owned job and appear by id in its input. Legacy snapshots
  without ids are screened but never persisted. Practice answers also require matching
  question and answer revisions; generated questions are trusted without re-screening.

  Preference criteria use the owner's `screened_criteria_sha256` array, keyed by exact text.
  Listing checks use `screened_sha256` on the shared catalogue row. Its fingerprint covers
  the exact passage-text array, not the full posting's `source_digest`: a short excerpt
  cannot approve a longer excerpt. Rails reconstructs the task's bounded excerpt and
  verifies both passages and source digest under the listing lock. No prior-task-input
  search of current check-task inputs can grant an approval. Successful inputs from
  retired preference conversations are imported once per exact text into the profile's
  normal fingerprint store; validated historical generated output retains its provenance.
  Rails migrations and the new consumer must deploy before
  workers send these receipts; drain old workers/results before removing old consumers.

Per task type:

- `rerank_job_listings`: input `{keyword, listings: [{id, text}]}` is a Rails-owned snapshot
  of 1–100 shared catalogue listings, bounded to 200,000 UTF-8 JSON bytes. The worker embeds
  listing excerpts and uses only this owner's model-matched career-library embeddings for
  semantic order, fused equally with submitted-keyword BM25 (RRF k=60). The completed
  result is `{ranked_listing_ids: [...]}`; Rails rejects anything except an exact permutation
  of the snapshot IDs. Existing task budgets, attempt costs, subscriptions and duplicate
  completion handling apply. No catalogue-table grant or generative model is introduced.

- `parse_resume`: input `{source_file: {key, filename, content_type}}`, where `key` is the
  Active Storage blob key in the S3 uploads bucket. The completed result is
  `{parsed_resume: ParsedResume, job_title_suggestions: [...]}`. The optional suggestions are
  inferred search metadata, separate from faithfully extracted `ParsedResume` facts. The existing
  profile extraction response supplies up to five distinct titles (100 characters each), with no
  additional model call. Unusable suggestions are dropped without failing valid extracted facts;
  privacy restoration also applies before publication. The user reviews and
  edits it, then the `importParsedResume` mutation writes it to the career library and
  fills blank profile fields on the user (contact details, summary). It creates no resume;
  resumes are only created when tailoring for a job. Each task imports once, tracked by
  `AiTask#accepted_at`. Acceptance also saves nonempty valid suggestions from the owned stored
  task result to the user in the same transaction; client-reviewed JSON cannot set them.
  Later accepted imports replace suggestions; legacy/empty/unusable metadata preserves them.
  Replaying an accepted task cannot overwrite a later list. Parsing completion alone changes
  no saved suggestions. Library edits do not automatically refresh them.
  The AI worker validates the original extracted text limits, then `services/ai/pii/`
  detects names, emails, and phones locally using bundled Presidio/spaCy assets.
  Parsing screens the complete masked source once (using chunks when necessary), then
  concurrently extracts experience; projects and skills; and profile, education and
  certifications. Each group receives the full source. One deadline and combined
  request/token budgets apply; failure cancels and awaits siblings, returning no partial
  parse. Warnings combine in group order with exact duplicates removed. Concrete provider
  requests, including fallback attempts, retain attempt-level usage accounting.
  Both Jev screening and parsing receive reversible typed placeholders, even when
  profile contact is empty or different. Structured output is restored before source
  checks and publication. Detector failures stop before either provider; unresolved
  generated tokens fail the import. Maps stay in one attempt's memory. English name
  detection is probabilistic and can miss names or mistake other text for names;
  addresses and general URLs are outside this boundary. See `services/ai/pii/README.md`.
- `scrape_job`: input `{url}` (a public HTTP(S) posting URL, at most 2,048 characters;
  LinkedIn links retain job-ID canonicalization). `Jobs::StartJobScrapingService` validates
  URL form and rejects owned duplicates. The worker validates every DNS answer and pins
  the destination IP on every redirect, blocking private/special IPv4/IPv6 and alternate ports.
  It forwards no client credentials/cookies, preserves environment proxies and original-host
  TLS verification, limits redirects to three and streamed pages to 2 MiB, rejects compressed
  or non-HTML responses, and checks a 20-second fetch budget with bounded DNS and I/O waits.
  Generic pages use one embedded JobPosting or selected main/article text. The parser must
  identify one actual job; list, home, login and access-denied pages fail rather than save.
  JavaScript-only or blocked sites fall back to pasted text. The completed result is
  `{scraped_job: ScrapedJobPosting}` (`services/ai/schemas/scraped_job_posting.py`: source,
  source_url, title, company, location, description, requirements, nice_to_haves,
  requirements_sorted_by, warnings). `ApplyAiResultService` saves it as a Job
  (`Jobs::CreateJobFromPostingService`, `url` = the canonical link) inside the same row lock,
  links it as the task's `subject` (GraphQL `AiTask.job`), and fails the task instead if the
  Job can't be saved. The worker cleans the selected description HTML into plain text,
  caps the description and acquired title/company/location, and uses the tool-free scraped-ad
  parser to copy requirements, duties and optional qualifications from prose or lists.
  This source-only parser does not classify prompt injection: its guard enforces one exact
  fenced source, size limits and no history. It has no action tools or private context and
  grants no screening approvals; later saved-job consumers retain their normal screening.
  Extracted spans must occur in the description; missing fields stay empty. The scraper's
  metadata stays authoritative when supplied by a site adapter/structured job object; for
  unstructured pages identity must be source-supported parser output. The original canonical
  task URL stays authoritative in both cases. Empty/oversized descriptions and
  unsupported parsed text fail instead of producing a job. The result includes a review
  warning and parsing usage, including validation attempts through worker accounting.
- `parse_job_posting`: input `{text}` (the pasted advertisement, stripped, at most 20,000
  characters; `Jobs::StartJobPostingParseService` rejects a blank or longer paste). The worker
  screens the text with Jev, then a Pydantic AI agent copies the title, company, optional
  location and link, and requirement lines. Title, company, and every bullet must appear in the
  paste; location or a link that does not is dropped with a warning. The description saved on
  the job is the paste itself. The completed result is `{scraped_job: ScrapedJobPosting}` with
  `source` `pasted_text`. `ApplyAiResultService` saves it
  (`Jobs::CreateJobFromPostingService`; `url` is the posting's `source_url`, or nil) inside
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

- `tailor_resume`: input `{job_id, contact, gap_analysis, gap_responses}`; the subject is the
  Job. Contact and gap fields are immutable request snapshots. The worker reads the owned
  job and career library, prepares shared screened evidence, and returns one complete draft:
  `{sections: [{section_type, title, content}], warnings: [...]}`. Display order is contact,
  summary, experience, projects, education, certifications, skills, omitting empty or
  nothing-fits sections. Contact, education, and certifications are copied; independent
  experience/project/skill writers overlap, and the summary uses selected content afterward.
  The task completes or fails without section approvals or a generation counter. Failure
  never publishes a partial draft. Users review, edit or exclude sections, preview, then
  `saveTailoredResume` creates snapshots once under owner-then-task locks (`accepted_at`).
  Starting tailoring checks saved resumes and resumable tasks under the same owner lock;
  queue publication follows commit. A completed unsaved draft is resumable only when it has
  at least one supported section (contact, summary, experience, projects, education,
  certifications, or skills) that is not omitted and has object content. Unsupported-only,
  omitted-only, and malformed completed results are history, so a new start queues a fresh
  task. Existing resumable work can be resumed even at usage limits.
  Later `updateResume` changes the saved resume only. `deleteResume` removes the owned resume
  and sections, including resumes whose job is gone, while keeping job/library/task history.
  An accepted task stays accepted and cannot be saved again after deletion. A remaining saved
  resume blocks new generation; after deletion, an explicit start creates a fresh task. See
  [tailoring decisions](career-library.md#decisions) for preparation and failure behavior.

- `generate_interview_questions`: input `{question_set_id, set_number, set_type, avoided_questions, recent_questions}`; the subject is an
  empty `InterviewQuestionSet`. The worker reads the current owned career library and returns
  `{interview_questions: {questions: [...]}, warnings: [...]}` with exactly five drafts.
  Rails snapshots at most 20 recent owned same-type question texts, newest set first and
  then slot order, as `recent_questions`. This optional field defaults to empty for older
  tasks. The worker renders it as soft variety guidance, separate from hard exclusions
  (`avoided_questions` and replacement siblings) and career evidence. History overlap adds
  no validation or retries. Answers and feedback never enter this snapshot.
  Each draft has `question_text`, `category`, and `evidence_quotes`; categories are
  `introduction`, `collaboration`, `problem_solving`, `learning_adaptation`, and
  `initiative_judgment` for general sets,
  or `work_overview`, `tools_methods`, `decisions_tradeoffs`, `problem_solving`, and
  `improvement_quality` for technical sets; or `concepts`, `mechanisms`, `application`,
  `reasoning`, and `limitations` for knowledge sets, one of each. Knowledge excerpts ground
  topic relevance, while model subject knowledge supplies subject questions.
  General sets contain one introduction and four realistic behavioral story invitations.
  Standard invitations about conflict or setbacks need no proof that an event occurred;
  specific personalized incidents still require evidence. Sparse backgrounds may draw on
  study, projects, volunteering or other real experience. Technical personal-experience
  grounding remains strict. Rails also accepts complete legacy general category sets
  (`introduction`, `strengths`, `development`, `goals`, `behavioral`) from in-flight older
  workers, but rejects mixtures of old and new categories. No category is persisted on slots.
  Deploy the compatible Rails consumer before the updated AI worker, since older Rails
  rejects the new categories. For rollback, restore the older worker before removing Rails
  compatibility. Existing saved questions and answers need no migration or rewrite.
- `regenerate_interview_question`: input `{question_set_id, question_id, question_text,
  answer_text, question_revision, answer_revision, other_questions, set_type}`; the subject is the
  selected `InterviewQuestion`. `other_questions` contains the other four saved questions.
  The worker uses the current library and returns the same question result shape with one
  draft, excluding both the old question and the other four.
  General replacements use behavioral themes, not another introduction or role motivation,
  even in old saved sets; the worker retries an introduction category. Older in-flight single
  replacements with legacy categories remain accepted. Other saved slots are untouched.
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
  throttling or 5xx, job site 429/5xx or network error; see `services/ai/worker/retryable_errors.py`)
  publishes usage without a completed or failed outcome and keeps the message. The worker
  shortens its visibility to 30s × the attempt number, so the retry
  comes sooner than the 300-second timeout.
- A **permanent** failure (bad input, bug, missing upload, invalid model output) publishes
  `failed` right away.
- The **last attempt** (`ApproximateReceiveCount` = `MAX_TASK_ATTEMPTS`, default 3) publishes
  `failed` even for a temporary error, so the user sees a result before SQS dead-letters the
  message. `MAX_TASK_ATTEMPTS` must equal the `ai_tasks` dead-letter `maxReceiveCount`.

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

- **Queued features use plain Python workers.** Their communication stays on SQS; no
  HTTP layer or token streaming is added to those workers. Basic Interview has a scoped
  [internal HTTP exception](interview-sessions.md): a separate FastAPI runtime claims
  Rails-owned durable operations. It does not change existing queue contracts.

- **AI tasks outlive their job.** `Job has_many :ai_tasks, dependent: :nullify`: deleting a job
  clears the tasks' subject but keeps them, so their cost still counts toward the monthly
  budget.

- **Uploads go to S3; only the key goes over SQS.** SQS messages are capped at 256 KB, so
  Rails stores uploads with Active Storage (S3 service) and the worker downloads them by blob
  key, read-only. Locally the bucket is Adobe S3Mock (MinIO's community edition is archived,
  LocalStack needs an account token). Text extraction (pypdf, python-docx) happens in Python,
  next to the agents. The upload's type is detected from its bytes, not the client's claim.

### Career library review

`review_library_section` takes `{section, library, targets}`: a Rails-owned snapshot of one selected
section (`summary`, `experience`, `projects`, or `career_contexts`) with saved field-check metadata and short-label target identities/context digests.
It returns `{assessments: [{kind, record_id, field, source_digest, color, reason, questions, question}]}`.
The ordered `questions` list contains zero to three distinct, nonblank questions, each at most
500 characters. `question` mirrors its first item or null for legacy scalar consumers; old results
with only `question` normalize to a one-item list, and old questionless results normalize to an empty list.
If both representations are present they must agree. The model emits only target labels, colors,
reasons, and questions; code copies the identities from the snapshot. Questions are completed
review output, not deferred calls: users can address each detail independently.
`answerLibraryReview(reviewTaskId:, kind:, recordId:, answers:)` accepts up to three
`{questionIndex, answer}` entries, keyed by zero-based index into the immutable saved questions.
Each answer is optional, but at least one trimmed answer must be nonblank. Rails rejects repeated
or out-of-range indices (even on blank entries), more than three entries, and answers over 4,000
characters. It resolves every question from the owned current review and queues one individual
edit. Blank fields are omitted; nonblank answers are stored in question order for idempotency.
The scalar `answer:` argument remains supported for older clients and means question index zero;
it cannot be combined with `answers:`.

A batch input adds `review_question: {review_task_id, answers: [{question_index, question, answer}]}`
to the existing edit contract. Each answer has its own prose cap; they are not flattened into the
standalone `feedback` field. Its 4,000-character cap and the 180,000-byte task input cap remain.
Legacy tasks with `review_question: {review_task_id, question}` and their answer in `feedback`
still work. Browser input never supplies generated question text or model history. Without saved
history, the worker screens each answered field and renders labeled question/answer pairs;
with owned saved history, only new feedback needs screening. Generated questions are trusted
context, not evidence that a premise happened. Omitted questions never become unknown-outcome
claims. This mode disables deferred questions on every linked turn; Rails rejects paused results.

Canonical equivalent batches reuse the latest turn for that origin; different answers and unrelated
active drafts conflict. Failed batches can retry with empty new feedback using their owned saved
pairs, without claiming that the user skipped a question. Ordinary continuations still need feedback
or an explicit skip. Later editing feedback preserves the batch and uses existing private history.
Acceptance/discard retain normal closed-task and late-result protections.

`libraryReview` assessment `reviewTaskId` identifies the completed source review independently
of the latest section task. Accepted or discarded review-answer questions are retired; old
questionless assessments remain valid.

`reviewLibrarySection` starts or reuses an active section task; `libraryReview(section:)`
returns its latest task and last completed grades with current freshness. No career text is
saved by this task. Unsupported sections fail before enqueueing; oversized sections fail
without truncation. Existing usage limits, retries, privacy, and subscriptions apply.

## Task outcome notifications

The signed-in workspace shows an in-app notice when any AI task completes or fails,
including when the user is already on its page. This covers queued work and durable
interview work; no task-type allowlist or current-page suppression applies. A pause
for user input, usage accounting, or an automatic execution retry is not a terminal
outcome. Existing pages continue to show their detailed task state and errors.

Rails records terminal occurrences separately from the current task state. This is
necessary because an explicit interview retry can reuse a failed task and overwrite
its previous outcome. The occurrence contains task identity, type, status and completion
time; notice payloads contain a safe label and owned app destination rather than raw
model results, prompt input, provider errors, or recording URLs. Deleted destinations
fall back to an appropriate overview where possible.

Task changes and outcome insertion commit together. Writers acquire the owner lock
before task locks, which also orders occurrence cursors through commit for that owner.
Live delivery happens after all enclosing transactions commit. Transport failure does
not undo accepted work: the saved occurrences support subsequent catch-up. Existing
per-task subscriptions remain available to feature pages.

The browser subscribes before querying missed outcomes. The initial subscription
payload waits for ActionCable pubsub confirmations, then reads a fresh committed
cursor through the saved GraphQL operation. Resolver execution alone does not establish
listener readiness. Session bootstrap and
sign-in also supply an owner-scoped starting watermark, captured before workspace
actions become available; this prevents fast completions before subscription readiness
from being mistaken for historical work. On first use, older outcomes stay quiet.
On subsequent visits, a saved checkpoint takes precedence so missed work can recover.

Recovery reads bounded, ordered pages through the confirmed cursor. Live broadcasts
can arrive out of order, so the browser recovers the complete range before advancing
its checkpoint rather than trusting broadcast arrival order. Each occurrence has its
own identity, including a new outcome after an explicit retry of the same task.

A browser Web Lock coordinates delivery and checkpoint writes across tabs for the
same owner. Hidden tabs leave unseen work available for recovery until visible;
notices remain until dismissed or opened. Browser storage contains only an owner-scoped
cursor, not task contents. Without usable storage or Web Locks, live notices continue,
but reload recovery or cross-tab duplicate prevention depends on the facilities still
available. Online and visibility events retry recovery without polling. Signing out
or replacing the account stops its feed and discards its mounted notice state.
