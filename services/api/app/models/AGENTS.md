# AGENTS.md — services/api/app/models

## Purpose

Domain models. Associations, validations, enums, and tiny predicates only; no business logic.

## Contents

- `user.rb` — account (Devise + JWT); owns everything below. Profile columns (`name`,
  `contact_email`, `phone`, `location`, `links`, `summary`) are filled from an imported resume
  where blank and copied into tailored resumes. Nullable
  `monthly_ai_budget_microdollars`, `ai_tasks_per_hour_limit`, `max_in_flight_ai_tasks` override
  the global AI usage limits
- `jwt_denylist.rb` — revoked tokens (sign-out)
- Career library (source of truth for the user's facts):
  - `experience.rb` + `experience_highlight.rb` (ordered bullet points)
  - `project.rb`, `education.rb`, `skill.rb`
  - `library_embedding.rb` — derived data: the embedding (pgvector, 1536 dimensions, HNSW
    cosine index, `has_neighbors`) of one library entry's text, keyed by `source_type` +
    `source_id` (no foreign key; the sync deletes orphans), with `content`, `content_digest`, and
    `model`. Written only by `CareerLibrary::SyncLibraryEmbeddingsService`; the AI worker reads it
  - `concerns/most_recent_first.rb` — `most_recent_first` scope for experiences, projects, and
    educations (ongoing first, then by end date, undated last); `User` lists them this way
- `job.rb` — job profile + application stage; `ai_tasks` it is the subject of (scrape,
  gap analyses; nulled, not deleted, with the job so costs stay counted) and
  `latest_gap_analysis`
- `resume.rb` + `resume_section.rb` — resumes tailored to a job (there is no base resume; the
  career library is the base). Section `content` is a JSON snapshot, so editing a resume never
  changes the career library (content shapes in `resume_section.rb`). A resume needs a job only
  on create; deleting the job keeps the resume (job nulled)
- `ai_task.rb` — one unit of AI work over SQS; `finished?` drives duplicate-result handling;
  `source_file` (Active Storage) is the upload a task reads; `accepted?` once its result has
  been imported; token columns and `cost_microdollars` come from the worker's reported usage

## Local Rules

- String enums: define a frozen `CONSTANT` list and use `enum :field, CONSTANT.index_with(&:itself), validate: true`.
  GraphQL enums are generated from these constants, so add values in one place.
- Ordered children use a `position` column and an ordered `has_many` scope. Dated career
  library entries are the exception: they are ordered by date, and `position` only breaks ties.
