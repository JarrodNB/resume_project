# AGENTS.md — services/api/app/models

## Purpose

Domain models. Associations, validations, enums, and tiny predicates only; no business logic.

## Contents

- `interview_question_embedding.rb` — one current derived vector per interview question, with original Q&A, masked content digest, model, and source revisions; cascades on question deletion and has no retrieval interface.

- `ai_usage_attempt.rb` — per-execution accounting reports and durable unknown-cost markers;
  finalized reports are immutable and independent of task outcome. Spoken interview
  unknown reports may reconcile once to known through `Interviews::RecordUsageService`;
  known reports remain immutable.

- `user.rb` — account (Devise + Rails sessions); owns everything below. Profile columns (`name`,
  `contact_email`, `phone`, `location`, `links`, `summary`) are filled from an imported resume
  where blank and copied into tailored resumes. Nullable
  `monthly_ai_budget_microdollars`, `ai_tasks_per_hour_limit`, `max_in_flight_ai_tasks` override
  the general AI usage limits; spoken interviews have separate environment-backed limits
- `jwt_denylist.rb` — legacy token records retained for migration safety; browser
  authentication no longer accepts JWTs.
- Career library (source of truth for the user's facts):
  - `experience.rb` + `experience_highlight.rb` (ordered bullet points)
  - `project.rb`, `education.rb`, `skill.rb`
  - `library_fact.rb` — a requirement plus the user's answer, added from a gap response; embedded
    like the other entries. Deleting it unlinks job answers (`dependent: :nullify`) and keeps them
  - `library_embedding.rb` — derived data: the embedding (pgvector, 1536 dimensions, HNSW
    cosine index, `has_neighbors`) of one library entry's text, keyed by `source_type` +
    `source_id` (no foreign key; the sync deletes orphans), with `content`, `content_digest`, and
    `model`. Written only by `CareerLibrary::SyncLibraryEmbeddingsService`; the AI worker reads it
  - `concerns/most_recent_first.rb` — `most_recent_first` scope for experiences, projects, and
    educations (ongoing first, then by end date, undated last); `User` lists them this way
  - `concerns/library_size_limit.rb` — `library_size_limit` stops a create once the user is at
    the cap in `config/initializers/text_limits.rb` (roles, projects, education, skills, facts)
- `job.rb` — job profile + application stage; `ai_tasks` it is the subject of (scrape,
  gap analyses, tailoring; nulled, not deleted, with the job so costs stay counted),
  `gap_responses` (deleted with the job; library facts they point at are kept),
  `latest_gap_analysis`, and `latest_tailoring`
- `resume.rb` + `resume_section.rb` — resumes tailored to a job (there is no base resume; the
  career library is the base). Section `content` is a JSON snapshot, so editing a resume never
  changes the career library (content shapes in `resume_section.rb`). A resume needs a job only
  on create; deleting the job keeps the resume (job nulled)
- `ai_task.rb` — one unit of AI work over SQS; `finished?` drives duplicate-result handling;
  `source_file` (Active Storage) is the upload a task reads; `accepted?` once its result has
  been imported; token columns and `cost_microdollars` come from the worker's reported usage;
  historical `generation` and `usage_generation` columns are unused; attempt IDs deduplicate
  current usage reports

## Local Rules

- String enums: define a frozen `CONSTANT` list and use `enum :field, CONSTANT.index_with(&:itself), validate: true`.
  GraphQL enums are generated from these constants, so add values in one place.
- Ordered children use a `position` column and an ordered `has_many` scope. Dated career
  library entries are the exception: they are ordered by date, and `position` only breaks ties.

- `certification.rb` — independent credentials with issued/expiry dates, credential ID/URL and optional description.

- Certification date precision metadata distinguishes stated years/months from exact dates.

- `interview_question_set.rb` + `interview_question.rb` — user-owned practice sets, ordered question slots, typed answers, and revision-bound feedback; separate from the career library. AI task subjects are nulled on deletion to preserve usage accounting.
- Practice set scopes are immutable `general`, `technical`, or `knowledge`; legacy data defaults to general.

- Interview task types: `generate_interview_questions`, `regenerate_interview_question`, and `review_interview_answer`; Python handlers return structured results, and `InterviewPrep` services apply them through `AiTasks::ApplyAiResultService`.

- `interview_session*` — separate spoken demo sessions, prepared questions, accepted
  dialogue and durable turn/speech work. Composite foreign keys keep linked records in
  one interview. Lifecycle policy stays in `Interviews` services. `InterviewExecutionAttempt`
  and `InterviewProviderAttempt` bind durable execution/provider identities to shared
  AiUsageAttempt ledger entries; missing reports remain incomplete.
