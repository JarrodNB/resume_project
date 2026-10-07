# AGENTS.md — features/jobs

## Purpose

Saved jobs: add one from a job posting link (`scrapeJob`, followed live with `aiTaskUpdated`)
or by hand (`createJob`), list them, and view one. Rails saves a scraped job itself when
scraping completes; there is no review step. A saved job can be edited, moved between
application stages, and deleted.

## Contents

- `JobsPage.tsx` (`/jobs`) — job list with stage badges, "Add job from link", and "Add manually"
- `AddJobFromUrlPage.tsx` (`/jobs/new`) — URL form calling `scrapeJob`
- `JobScrapeTaskPage.tsx` (`/jobs/new/:aiTaskId`) — live status; redirects to the saved job
  (`aiTask.job`), or shows the scraper's warnings first; failures offer "Try another link"
- `JobDetailPage.tsx` (`/jobs/:id`) — edit, stage select (`moveJobToStage`), delete, gap analysis
  card (`features/gap-analysis/`, including gap responses), and `WriteResumeAction.tsx`.
  "Write resume" is always shown and goes to `/jobs/:id/tailor`. A finished comparison goes
  straight there. Otherwise `ConfirmWriteResumeDialog.tsx` recommends comparing first, and
  "Write resume anyway" continues. "Open resume" goes to `/resumes/:id` when one is already
  saved, and that page's breadcrumb returns here.
  requirements, nice-to-haves, notes, description (those cards start collapsed, remembered per
  job), the applied date once set, and a link to the original posting
- `JobFormDialog.tsx`, `StringListField.tsx`, `jobFormValues.ts`, `useSaveJob.ts` — the shared
  add and edit form; every field is sent, and a blank optional string is stored as null
- `JobStageSelect.tsx`, `DeleteJobDialog.tsx`, `ConfirmWriteResumeDialog.tsx`,
  `WriteResumeAction.tsx`, `JobDetailCards.tsx` — stage control, delete confirmation, the
  optional-comparison confirmation, the resume action, and the collapsible cards
- `jobsOperations.ts` — `JOBS_QUERY`, `JOB_QUERY` (includes `latestGapAnalysis`,
  `gapResponses`, `resume`, `notes`, and `appliedAt`),
  `SCRAPE_JOB_MUTATION`, `CREATE_JOB_MUTATION`, `UPDATE_JOB_MUTATION`,
  `MOVE_JOB_TO_STAGE_MUTATION`, `DELETE_JOB_MUTATION`; hooks `useJobs.ts`
  (`useJobs`, `useJob`), `useScrapeJob.ts`
- `jobStageLabels.ts` — stage labels; `scrapedJobWarnings.ts` — warnings from
  `result.scraped_job` (mirror of `services/ai/schemas/scraped_job_posting.py`)
- `*.test.tsx` — list, manual add, edit, stage, delete, URL form, task page states

## Local Rules

- Stage changes go through `moveJobToStage`, which records `appliedAt` the first time a job
  leaves Not applied. Editing a requirement's wording does not rewrite saved answers.
- Deleting a job removes its answers. A tailored resume written for it stays, unlinked.
- The task page must work on reload: the subscription sends the task's current state first.
