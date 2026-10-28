# AGENTS.md — features/jobs

## Purpose

Saved jobs: add one from a job posting link (`scrapeJob`), from a pasted advertisement
(`parseJobPosting`), or by hand (`createJob`), list them, and view one. Both AI paths are
followed live with `aiTaskUpdated`. Rails saves the job itself when the task completes; there
is no review step. A saved job opens as a workspace with tabs for the work on that job. It can
be edited, moved between application stages, and archived.

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
- `JobWorkspaceLayout.tsx` (`/jobs/:id`) — loads the job and owns the live comparison
  (`useGapAnalysis`), shared with every tab. The header shows title, company · location, the
  applied date once set, `JobStageSelect` (`moveJobToStage`), `WriteResumeAction` (only when the
  job has no resume and the Resume tab isn't open), and `JobActionsMenu.tsx` ("More job actions":
  Edit job, Visit website when a URL is saved, Archive job). Visit website opens a new tab and does
  not change the stage. Below it, the "Job sections" tabs:
  Fit (`/jobs/:id`), Resume (`/jobs/:id/resume`, `features/resume-tailoring/`), Study
  (`/jobs/:id/study`), Interview (`/jobs/:id/interview`, `features/interviews/`), and Posting
  (`/jobs/:id/posting`).
- `useJobWorkspace.ts` — tabs read the loaded job and comparison from the layout's outlet context
- `JobWorkspaceTabs.tsx` — `JobFitTab` (gap analysis card with gap responses), `JobStudyTab`
  (`features/study-guides/` `StudyGuidePanel`), and `JobPostingTab` (requirements,
  responsibilities, nice-to-haves, and notes always open; the full description collapses,
  remembered per job)
- `WriteResumeAction.tsx` — "Open resume" goes to `/jobs/:id/resume`. "Write resume" is disabled
  while a comparison is starting or active. A finished comparison goes straight to
  `/jobs/:id/resume/write`. Otherwise `ConfirmWriteResumeDialog.tsx` recommends comparing first:
  "Compare first" starts the shared comparison, and "Write resume anyway" continues without it.
- `JobFormDialog.tsx`, `StringListField.tsx`, `jobFormValues.ts`, `useSaveJob.ts` — the shared
  add and edit form; every field is sent, and a blank optional string is stored as null
- `JobStageSelect.tsx`, `ArchiveJobDialog.tsx`, `JobDetailCards.tsx` — stage control, archive
  confirmation, and the collapsible card for the full description
- `jobsOperations.ts` — `JOBS_QUERY`, `JOB_QUERY` (includes `latestGapAnalysis`,
  `gapResponses`, `resume`, `notes`, and `appliedAt`),
  `SCRAPE_JOB_MUTATION`, `PARSE_JOB_POSTING_MUTATION`, `CREATE_JOB_MUTATION`,
  `UPDATE_JOB_MUTATION`, `MOVE_JOB_TO_STAGE_MUTATION`, `ARCHIVE_JOB_MUTATION`; hooks `useJobs.ts`
  (`useJobs`, `useJob`), `useScrapeJob.ts`, `useParseJobPosting.ts`
- `jobStageLabels.ts` — stage labels; `scrapedJobWarnings.ts` — warnings from
  `result.scraped_job` (mirror of `services/ai/schemas/scraped_job_posting.py`)
- `*.test.tsx` — list, manual add, workspace header and tabs, edit, stage, archive, URL form, task page states

## Local Rules

- Stage changes go through `moveJobToStage`, which records `appliedAt` the first time a job
  leaves Not applied. Editing a requirement's wording does not rewrite saved answers.
- A job requires a title. Company is nullable: show **Unknown company** in saved-job labels,
  leave its edit input empty, and send null when the field is cleared.
- Archiving hides a job from saved jobs and Home; answers, resumes, interviews, and AI history stay linked.
- A tab's main content stays open; only long extras (the full description) collapse.
- The task page must work on reload: the subscription sends the task's current state first.
