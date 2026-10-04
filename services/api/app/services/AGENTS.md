# AGENTS.md — services/api/app/services

## Purpose

All business logic, as service objects grouped by domain folder.

## Contents

- `application_service.rb` — base class: `self.call(...)`, `success(value)`, `failure(errors)`
- `service_result.rb` — immutable result: `success?`, `value`, `errors`
- `records/destroy_record_service.rb` — generic destroy for an already-authorized record
- `jobs/` — `create_job_service.rb`, `update_job_service.rb`, `move_job_to_stage_service.rb`;
  `start_job_scraping_service.rb` (accepts LinkedIn job links only, canonicalizes them to
  `https://www.linkedin.com/jobs/view/<id>/`, rejects a job the user already saved, enqueues
  `scrape_job`); `create_job_from_scraped_posting_service.rb` (saves the Job from a
  `ScrapedJobPosting` with the task's canonical URL; reuses the user's Job for the same URL)
- `experiences/` — `create_experience_service.rb`, `update_experience_service.rb`,
  `move_highlight_service.rb` (moves a highlight within or between roles, keeping its id, and
  renumbers positions in both roles)
- `career_library/` — duplicate matching and merging of experiences, projects, and educations,
  and reordering of library entries (see `career_library/AGENTS.md`)
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
