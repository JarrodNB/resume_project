# AGENTS.md — features/resumes

## Purpose

The user's saved tailored resumes. The list is its own page (Jobs → Resumes) because resumes
outlive deleted jobs. A resume whose job still exists lives on that job's Resume tab; this
feature only edits resumes whose job was deleted.

## Contents

- `ResumesPage.tsx` (`/resumes`) — resumes, most recently updated first, or a link to Jobs
  when there are none. A row links to `/jobs/:jobId/resume` when linked, else `/resumes/:id`
- `ResumePage.tsx` (`/resumes/:id`) — redirects a linked resume to its job's Resume tab;
  otherwise the saved editor (`SavedResumeEditor` from resume-tailoring) with "Back to resumes"
- `resumesOperations.ts` — `RESUMES_QUERY`, `RESUME_QUERY`; `useResumes.ts` (`useResumes`,
  `useResume`)
- `useDeleteResume.ts` removes a saved resume and its cached detail/list/job references;
  `DeleteResumeDialog.tsx` confirms permanent deletion and shows retryable errors.
- `*.test.tsx` — the list, the empty state, and opening one resume (the PDF preview is mocked)

## Local Rules

- Writing a resume happens on the job's Resume tab (`/jobs/:id/resume/write`). This page is for
  saved resumes whose job is gone; a resume stays in the list after its job is deleted.
- Deletion from this route returns to `/resumes`. The shared editor delegates the return
  destination to its route.
