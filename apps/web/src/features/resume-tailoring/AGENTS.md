# AGENTS.md — features/resume-tailoring

## Purpose

Write a resume for one job, one section at a time, after a gap analysis. The worker pauses
for each section; this page edits the current one and saves the finished draft once. A later
visit edits that saved resume. Preview opens the current draft as a large PDF.

## Contents

- `TailorResumePage.tsx` (`/jobs/:id/tailor`) — approved sections, the section being written,
  the open editor, the final editor, or the saved resume (`SavedResumeEditor.tsx`, also used
  by `/resumes/:id`). Preview opens `ResumePdfPreview.tsx` in a dialog at actual size
- `OpenSectionCard.tsx` — the current section ("Use this and continue"; leave out or write
  anyway when nothing fits; a blocked edit stays open)
- `FinalResumeEditor.tsx` — every finished section, then Save; each section starts collapsed
  (`resume.<jobId>.<sectionType>`), and its draft stays in the parent while collapsed
- `SectionFields.tsx` — resume-import review fields for one section
- `SectionPreview.tsx` — a decided section, with "Edit again" while tailoring is open. The text
  starts collapsed; "Edit again" stays on the header. `SectionPreviewBody.tsx` shows a role,
  project, or school as a card (heading, dates, bullets), not one block of text. The section
  being written does not collapse
- `sectionOrder.ts` — section order and which section a queued task is writing
- `tailorDraft.ts` — section JSON to and from the review-field draft
- `parseTailorTask.ts` — approved sections, the open question, and the finished draft
- `tailorOperations.ts` — the job query and start / submit / save / update mutations
- `useResumeTailoring.ts` — load, start when needed, follow `aiTaskUpdated`
- `useTailorActions.ts` — submit one section or save the resume the first time
- `useUpdateResume.ts` — `updateResume` for a resume that is already saved
- `resumePdfModel.ts` — saved sections to the plain structure the PDF draws (`ResumePdfDocument.tsx`
  is that document; a later download uses it). `resumePdfModel.test.ts`
- `TailorResumePage.test.tsx` — queued, editor, blocked, nothing-fits, save, saved resume.
  The PDF preview is mocked; jsdom cannot draw it

## Local Rules

- Reload reads the task (`input` and `pendingQuestions` on `aiTaskUpdated`, and
  `Job.latestTailoring`). There is no token streaming.
- Reopening a section sends `reopen`; the worker discards every section after it.
- The first save is once (`saveTailoredResume`). A later visit edits `Job.resume` with
  `updateResume`. Preview shows the current draft, including edits that are not saved yet.
