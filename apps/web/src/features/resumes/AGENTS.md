# AGENTS.md — features/resumes

## Purpose

The user's saved tailored resumes. The list is its own page. Opening one edits that resume.
A job still links here once a resume is saved, and this page links back to the job.

## Contents

- `ResumesPage.tsx` (`/resumes`) — resumes, most recently updated first, or a link to Jobs
  when there are none
- `ResumePage.tsx` (`/resumes/:id`) — the saved editor (`SavedResumeEditor` from
  resume-tailoring). The breadcrumb returns to the job when opened from that job, and to
  the list otherwise. The job name links to the job either way, while the job still exists
- `resumesOperations.ts` — `RESUMES_QUERY`, `RESUME_QUERY`; `useResumes.ts` (`useResumes`,
  `useResume`)
- `*.test.tsx` — the list, the empty state, and opening one resume (the PDF preview is mocked)

## Local Rules

- Writing a resume still happens on `/jobs/:id/tailor`. This page is for resumes that are
  already saved. A resume stays here after its job is deleted.
