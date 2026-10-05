# AGENTS.md — features/jobs

## Purpose

Saved jobs: add one from a job posting link (`scrapeJob`, followed live with `aiTaskUpdated`),
list them, and view one. Rails saves the Job itself when scraping completes; there is no review
step.

## Contents

- `JobsPage.tsx` (`/jobs`) — job list with stage badges and an "Add job from link" button
- `AddJobFromUrlPage.tsx` (`/jobs/new`) — URL form calling `scrapeJob`
- `JobScrapeTaskPage.tsx` (`/jobs/new/:aiTaskId`) — live status; redirects to the saved job
  (`aiTask.job`), or shows the scraper's warnings first; failures offer "Try another link"
- `JobDetailPage.tsx` (`/jobs/:id`) — gap analysis card (`features/gap-analysis/`, including
  gap responses), a "Write resume" link to `/jobs/:id/tailor` once a comparison has finished
  ("Open resume" when one is already saved), read-only requirements, nice-to-haves,
  description (those three cards start collapsed, remembered per job), and a link to the
  original posting
- `jobsOperations.ts` — `JOBS_QUERY`, `JOB_QUERY` (includes `latestGapAnalysis`,
  `gapResponses`, and `resume`),
  `SCRAPE_JOB_MUTATION`; hooks `useJobs.ts`
  (`useJobs`, `useJob`), `useScrapeJob.ts`
- `jobStageLabels.ts` — stage labels; `scrapedJobWarnings.ts` — warnings from
  `result.scraped_job` (mirror of `services/ai/schemas/scraped_job_posting.py`)
- `*.test.tsx` — list, URL form, task page states

## Local Rules

- Not built yet: editing jobs, moving stages, deleting (the mutations exist in Rails).
- The task page must work on reload: the subscription sends the task's current state first.
