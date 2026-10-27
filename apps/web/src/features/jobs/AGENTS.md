# AGENTS.md — features/jobs

## Purpose

Saved jobs: add one from a job posting link (`scrapeJob`), from a pasted advertisement
(`parseJobPosting`), or by hand (`createJob`), list them, and view one. Both AI paths are
followed live with `aiTaskUpdated`. Rails saves the job itself when the task completes; there
is no review step. A saved job can be edited, moved between
application stages, and deleted.

## Contents

- `JobsPage.tsx` (`/jobs`) — job list with stage badges, "Paste a job ad", "Add job from link",
  and "Add manually"
- `AddJobFromUrlPage.tsx` (`/jobs/new`) — URL form calling `scrapeJob`
- `AddJobFromTextPage.tsx` (`/jobs/paste`) — textarea calling `parseJobPosting`
- `JobImportTaskPage.tsx` — shared live status for a job import
- `JobScrapeTaskPage.tsx` (`/jobs/new/:aiTaskId`) — scrape status; redirects to the saved job
  (`aiTask.job`), or shows warnings first; failures offer "Try another link"
- `JobPasteTaskPage.tsx` (`/jobs/paste/:aiTaskId`) — paste status; same redirect, failures offer
  "Try another ad"
- `JobBoardImportNotice.tsx` — displays import warnings from navigation state only for the matching saved Job
- `JobDetailPage.tsx` (`/jobs/:id`) — edit, stage select (`moveJobToStage`), delete, gap analysis
  card (`features/gap-analysis/`, including gap responses), remembered Study guides section
  (`features/study-guides/`), and `WriteResumeAction.tsx`.
  "Write resume" is disabled while a comparison is starting or active. Otherwise it goes
  to `/jobs/:id/tailor`. A finished comparison goes
  straight there. Otherwise `ConfirmWriteResumeDialog.tsx` recommends comparing first, and
  "Compare first" starts the shared comparison on this page; "Write resume anyway" continues
  without comparing. "Open resume" goes to `/resumes/:id` when one is already
  saved, and that page's breadcrumb returns here.
  "Practise interview" goes to `/jobs/:jobId/interview` for spoken setup using that saved
  job and the career library; it does not require a comparison or change the job stage.
  requirements, responsibilities, nice-to-haves, notes, description (those cards start collapsed, remembered per
  job), the applied date once set, and a "Visit website" link to the saved URL. The link
  opens a new tab and does not change the application stage; omit it when no URL is saved.
- `JobFormDialog.tsx`, `StringListField.tsx`, `jobFormValues.ts`, `useSaveJob.ts` — the shared
  add and edit form; every field is sent, and a blank optional string is stored as null
- `JobStageSelect.tsx`, `DeleteJobDialog.tsx`, `ConfirmWriteResumeDialog.tsx`,
  `WriteResumeAction.tsx`, `JobDetailCards.tsx` — stage control, delete confirmation, the
  optional-comparison confirmation, the resume action, and the collapsible cards
- `jobsOperations.ts` — `JOBS_QUERY`, `JOB_QUERY` (includes `latestGapAnalysis`,
  `gapResponses`, `resume`, `notes`, and `appliedAt`),
  `SCRAPE_JOB_MUTATION`, `PARSE_JOB_POSTING_MUTATION`, `CREATE_JOB_MUTATION`,
  `UPDATE_JOB_MUTATION`, `MOVE_JOB_TO_STAGE_MUTATION`, `DELETE_JOB_MUTATION`; hooks `useJobs.ts`
  (`useJobs`, `useJob`), `useScrapeJob.ts`, `useParseJobPosting.ts`
- `jobStageLabels.ts` — stage labels; `scrapedJobWarnings.ts` — warnings from
  `result.scraped_job` (mirror of `services/ai/schemas/scraped_job_posting.py`)
- `*.test.tsx` — list, manual add, edit, stage, delete, URL form, task page states

## Local Rules

- Stage changes go through `moveJobToStage`, which records `appliedAt` the first time a job
  leaves Not applied. Editing a requirement's wording does not rewrite saved answers.
- A job requires a title. Company is nullable: show **Unknown company** in saved-job labels,
  leave its edit input empty, and send null when the field is cleared.
- Deleting a job removes its answers. A tailored resume written for it stays, unlinked.
- The task page must work on reload: the subscription sends the task's current state first.
