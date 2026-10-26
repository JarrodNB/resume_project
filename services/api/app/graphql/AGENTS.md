# AGENTS.md — services/api/app/graphql

## Purpose

The GraphQL API used by `apps/web`. Every request is authenticated by `GraphqlController`.

## Contents

- `api_schema.rb` — root schema; turns `RecordNotFound` into a "Record not found" error;
  subscriptions use `ActionCableSubscriptions`
- `types/` — object types, enums, inputs, and the root `query_type.rb` / `mutation_type.rb` /
  `subscription_type.rb`; `me { aiUsage }` (`ai_usage_type.rb`) is this month's AI spend vs budget
- `mutations/` — one file per mutation, grouped by domain (`mutations/jobs/create_job.rb`);
  `mutations/resume_imports/` has `parseResume` (file upload) and `importParsedResume`;
  `mutations/jobs/scrape_job.rb` (`scrapeJob(url)`) queues scraping, and
  `mutations/jobs/parse_job_posting.rb` (`parseJobPosting(text)`) queues a pasted ad; the task's
  `job` field (`types/ai_task_type.rb`) is the saved Job once either completes;
  `mutations/gap_analysis/analyze_job_gaps.rb` (`analyzeJobGaps(jobId)`) queues a gap analysis,
  and `Job.latestGapAnalysis` (`types/job_type.rb`) is the job's newest analyze_gaps task;
  `mutations/resume_tailoring/` has `startResumeTailoring(jobId)`,
  `saveTailoredResume(aiTaskId, sections)`, `updateResume(id, sections)`, and `deleteResume(id)`;
  deletion uses the owned resume and removes its sections, preserving job/library/task history;
  `Job.latestTailoring`
  and `Job.resume` are the newest tailor task and the newest saved resume; `AiTask.input` stores
  the request snapshots; tailoring returns its complete editable draft in `AiTask.result`;
  `mutations/gap_responses/save_gap_response.rb` (`saveGapResponse`) saves an answer on that job,
  and `Job.gapResponses` lists them; `mutations/library_facts/delete_library_fact.rb`
  (`deleteLibraryFact`) removes a fact (`libraryFacts` on the root query);
  career library entries have create and update (`create*` / `update*` for projects,
  educations, skills, and library facts; experiences already had both; `updateProfile` edits
  name, contact details, links, and summary), `delete*` (experiences, projects, educations,
  skills, library facts), `clearCareerLibrary` (empties entries and the import-filled profile),
  and `merge*(targetId, sourceId)` (experiences, projects, educations;
  both ids are looked up through `current_user`); drag-and-drop uses `mutations/skills/reorder_skills.rb`
  (`reorderSkills(orderedIds)`) and `mutations/experiences/move_experience_highlight.rb`
  (`moveExperienceHighlight(highlightId, experienceId, position)`, returning both roles)
- `subscriptions/` — `base_subscription.rb`, `ai_task_updated.rb` (`aiTaskUpdated(id)`)
- `resolvers/` — generated base class (unused so far)

## Local Rules

- Private root query fields read through `current_user` associations. Job Board search reads the shared provider catalogue.
- Mutations: find private records via `current_user` (shared Job Board listing IDs are the exception), call one service, return
  `payload_from(result, :record_key)`. Payloads always include `errors: [String!]!`.
- Inputs are `<Noun>AttributesInput` with all-optional fields, shared by create and update.
- Enum types mirror model constants with `extend EnumFromValues; values_from Model::CONSTANT`.
- No Relay `node` / global-ID lookups: they bypass user scoping.
- Subscriptions check ownership in `subscribe` via `current_user` and return the current
  record, so clients never miss an update that landed before they subscribed. Services
  trigger them with `ApiSchema.subscriptions.trigger(:field_name, { id: ... }, record)`.
- After changing the schema, run `docker compose run --rm api bin/rails graphql:schema:dump`
  and commit `services/api/schema.graphql` (the web app generates its types from it).
- Test operations with `execute_graphql(query, user:, variables:)` from `spec/support`.
- File uploads use the GraphQL multipart request spec (`apollo_upload_server` middleware) and
  the `ApolloUploadServer::Upload` scalar. In specs, wrap `build_uploaded_file(...)` in
  `ApolloUploadServer::Wrappers::UploadedFile`.

- Profile link output and input types expose separate visible labels and destination URLs.
- Certification types/inputs and `mutations/certifications/` expose authorized create/update/delete/merge and the `certifications` query.

- Interview prep: `interviewQuestionSets` / `interviewQuestionSet(id)` expose persisted questions, revision metadata, outdated feedback, and latest tasks. `mutations/interview_prep/` provides generation, saving, regeneration, feedback, and deletion; question IDs are scoped through an owned set. `types/interview_question_set_type.rb` and `types/interview_question_type.rb` define these outputs.

Job Board search/import intentionally read shared provider catalogue records after HTTP authentication.
All saved Job lookup remains scoped to the current user, including listing/URL matches via
JobBoard::SavedJobLookup. Never expose raw catalogue payloads or provider credentials.

- Study guides: `generateStudyGuide(jobId)` queues description-only learning material; Job exposes separate `latestStudyGuide` (successful content) and `latestStudyGuideTask` (newest attempt). See `docs/architecture/study-guides.md` at the repository root.
