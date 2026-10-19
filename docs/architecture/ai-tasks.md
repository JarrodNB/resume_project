# AI tasks

Task execution and the contracts between Rails and Python workers.

[Architecture overview](../architecture.md) · [AI tasks](ai-tasks.md) · [Interview prep](interview-prep.md) · [AI safety and usage](ai-safety-and-usage.md) · [Career library](career-library.md)

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
  message_history, error_message, usage, attempt_id, attempt_finished, usage_incomplete, screening_successes}`.
  `status` is `completed`, `needs_user_input`, `failed`, or `usage` (accounting only).
  `screening_successes` defaults to `[]`; each entry contains `record_type`, `record_id`,
  `observed_updated_at` and `screening_policy_version`. Rails applies allowlisted,
  owner-scoped reports even for failed, retry-usage or late result messages, independently
  of task outcome and accounting deduplication. Atomic version matching prevents stale
  reports from restoring approval after edits; duplicate reports are harmless.
  `usage` lists `{model, input_tokens, cached_input_tokens, output_tokens, cost_microdollars}`
  per received provider response (`input_tokens` includes cached tokens; unknown prices are
  null). Each actual execution gets a fresh UUID, independent of SQS receive count.
  The worker publishes an unfinished, incomplete usage marker before
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
  `AiTask#accepted_at`, under the task's row lock.
  The AI worker validates the original extracted text limits, then `services/ai/pii/`
  detects names, emails, and phones locally using bundled Presidio/spaCy assets.
  Both Jev screening and parsing receive reversible typed placeholders, even when
  profile contact is empty or different. Structured output is restored before source
  checks and publication. Detector failures stop before either provider; unresolved
  generated tokens fail the import. Maps stay in one attempt's memory. English name
  detection is probabilistic and can miss names or mistake other text for names;
  addresses and general URLs are outside this boundary. See `services/ai/pii/README.md`.
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

- `tailor_resume`: input `{job_id, contact, gap_analysis, gap_responses}`; the subject is the
  Job. Contact and gap fields are immutable request snapshots. Each gap response carries
  `{id, updated_at, screened_at, screening_policy_version, requirement, body}`, constructed
  by Rails from the saved answer, omitting unset screening fields. The worker uses them directly; Rails
  rejects success reports for records edited since enqueue. The worker reads the owned
  job and career library, prepares shared screened evidence, and returns one complete draft:
  `{sections: [{section_type, title, content}], warnings: [...]}`. Display order is contact,
  summary, experience, projects, education, certifications, skills, omitting empty or
  nothing-fits sections. Contact, education, and certifications are copied; independent
  experience/project/skill writers overlap, and the summary uses selected content afterward.
  The task completes or fails without section approvals or a generation counter. Failure
  never publishes a partial draft. Users review, edit or exclude sections, preview, then
  `saveTailoredResume` creates snapshots once under owner-then-task locks (`accepted_at`).
  Starting tailoring checks saved resumes and resumable tasks under the same owner lock;
  queue publication follows commit. Existing work can be resumed even at usage limits.
  Later `updateResume` changes the saved resume only. `deleteResume` removes the owned resume
  and sections, including resumes whose job is gone, while keeping job/library/task history.
  An accepted task stays accepted and cannot be saved again after deletion. A remaining saved
  resume blocks new generation; after deletion, an explicit start creates a fresh task. See
  [tailoring decisions](career-library.md#decisions) for preparation and failure behavior.

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

## Duplicate Messages

Standard SQS delivers each message *at least* once, so a task or result can occasionally
arrive twice (a worker crashes before deleting, a task outlives its visibility timeout, or a
rare SQS redelivery). We handle this instead of trying to prevent it:

- **Rails result handling is idempotent.** Every message carries the `ai_task_id`. A finished
  task keeps its outcome; late usage and successful screening reports can still be applied.
  Successful screening reports apply first as independent atomic source updates. The
  consumer has no enclosing transaction: each stamp releases its row lock before the next
  stamp, avoiding retained multi-source locks during library edits. These derived checks
  may persist even if later outcome/accounting work fails; SQS redelivery retries that work.
  Outcome and usage updates lock the task. Interview results first lock the owner to match
  interview operations.
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

- **Plain Python workers, no FastAPI.** All communication is over SQS, so the AI service
  needs no HTTP layer. Trade-off: SQS can't stream LLM tokens to the browser. If live
  streaming is needed later (e.g. the gap analysis chat), add a small HTTP/WebSocket
  service at that point.

- **AI tasks outlive their job.** `Job has_many :ai_tasks, dependent: :nullify`: deleting a job
  clears the tasks' subject but keeps them, so their cost still counts toward the monthly
  budget.

- **Uploads go to S3; only the key goes over SQS.** SQS messages are capped at 256 KB, so
  Rails stores uploads with Active Storage (S3 service) and the worker downloads them by blob
  key, read-only. Locally the bucket is Adobe S3Mock (MinIO's community edition is archived,
  LocalStack needs an account token). Text extraction (pypdf, python-docx) happens in Python,
  next to the agents. The upload's type is detected from its bytes, not the client's claim.
