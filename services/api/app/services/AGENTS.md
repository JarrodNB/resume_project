# AGENTS.md — services/api/app/services

## Purpose

All business logic, as service objects grouped by domain folder.

## Contents

- `application_service.rb` — base class: `self.call(...)`, `success(value)`, `failure(errors)`
- `service_result.rb` — immutable result: `success?`, `value`, `errors`
- `records/destroy_record_service.rb` — generic destroy for an already-authorized record;
  deleting a career library entry queues an embedding sync
- `embeddings/open_ai_embedding_client.rb` — `embed_texts(texts)` via the OpenAI embeddings API
  (batches of 500, raises API errors for the job to retry); `configured?` checks
  `OPENAI_API_KEY`. The only place Rails calls OpenAI
- `jobs/` — `create_job_service.rb`, `update_job_service.rb`, `move_job_to_stage_service.rb`;
  `start_job_scraping_service.rb` (accepts LinkedIn job links only, canonicalizes them to
  `https://www.linkedin.com/jobs/view/<id>/`, rejects a job the user already saved, enqueues
  `scrape_job`); `create_job_from_scraped_posting_service.rb` (saves the Job from a
  `ScrapedJobPosting` with the task's canonical URL; reuses the user's Job for the same URL)
- `gap_analysis/start_gap_analysis_service.rb` — checks the job has requirements, the career
  library isn't empty, and no analysis for this job is already running (within the in-flight
  window), then enqueues `analyze_gaps` with the job as task `subject`; the result stays on the
  AiTask (`Job#latest_gap_analysis`)
- `experiences/` — `create_experience_service.rb`, `update_experience_service.rb`,
  `move_highlight_service.rb` (moves a highlight within or between roles, keeping its id, and
  renumbers positions in both roles)
- `career_library/` — duplicate matching and merging of experiences, projects, and educations,
  reordering of library entries, and syncing library embeddings (see `career_library/AGENTS.md`)
- `ai_tasks/enqueue_ai_task_service.rb` — checks the user's AI usage limits and creates a
  queued AiTask under a user row lock (optionally attaching its `source_file` blob), then
  publishes it to `ai_tasks`
- `ai_tasks/apply_ai_result_service.rb` — applies an `ai_results` message (idempotent, row
  lock), stores its token usage and cost, and triggers the `aiTaskUpdated` subscription; a
  completed `scrape_job` saves its Job in the same locked transaction (task `subject`), or the
  task fails if the Job can't be saved
- `ai_usage/check_ai_task_allowance_service.rb` — monthly budget, tasks per hour, tasks in
  flight (defaults in `config/initializers/ai_usage_limits.rb`, per-user override columns)
- `ai_usage/summarize_monthly_ai_usage_service.rb` — this month's spend, budget, reset time
- `resume_imports/start_resume_parsing_service.rb` — validates a PDF/DOCX upload (type from
  file bytes, 5 MB max) and the AI usage limits, stores it in S3, enqueues `parse_resume`
- `resume_imports/import_parsed_resume_service.rb` — imports a reviewed `ParsedResume` into
  the career library and fills blank user profile fields (contact, summary) once per task
  (`accepted_at`, row lock, one transaction); entries matching the library are merged, with
  the counts in `result["import_summary"]`; creates no resume
- `resume_imports/validate_parsed_resume_shape_service.rb` — rejects client JSON whose
  structure the import can't walk (wrong object/list types) with error messages, not a 500

## Local Rules

- Name services `<Verb><Noun>Service` in a domain module: `Jobs::MoveJobToStageService`.
- Subclass `ApplicationService`, take keyword arguments in `initialize`, expose only `call`.
- Always return a `ServiceResult` via `success`/`failure`; never raise for validation errors.
- Services receive records already scoped to the user; they don't do authorization lookups.
- Multi-record changes run in a transaction (see `UpdateExperienceService`).
- A service that changes career library text enqueues `CareerLibrary::SyncLibraryEmbeddingsJob`
  for the user (import, merge, experience create/update, highlight moved to another role,
  library deletes do today).
