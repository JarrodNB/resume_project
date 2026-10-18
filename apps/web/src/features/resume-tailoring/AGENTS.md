# AGENTS.md — features/resume-tailoring

## Purpose

Generate a complete resume draft for one job, then review, edit, exclude sections, preview,
and save it once. A finished gap analysis is included when one exists; generation does not
wait for it. Later visits edit the saved resume. Preview opens the current draft as a large PDF.

## Contents

- `TailorResumePage.tsx` (`/jobs/:id/tailor`) — whole-draft loading, failure/retry, the completed
  editor, or the saved resume (`SavedResumeEditor.tsx`, also used by `/resumes/:id`)
- `FinalResumeEditor.tsx` — edit, exclude/restore, preview, and save the finished sections; each
  section starts collapsed (`resume.<jobId>.<sectionType>`). Edits and inclusion stay together
  in the editor; preview and save use the same included content in draft order
- `SectionFields.tsx` — resume-import review fields for one section
- `sectionOrder.ts` — section names and display titles
- `tailorDraft.ts` — section JSON to and from the review-field draft
- `parseTailorTask.ts` — completed draft sections and warnings
- `tailorOperations.ts` — job query and start / save / update mutations
- `useResumeTailoring.ts` — load, start when needed, follow `aiTaskUpdated`, and retry failures
- `useTailorActions.ts` — save the reviewed resume the first time
- `useUpdateResume.ts` — `updateResume` for a resume that is already saved
- `resumePdfModel.ts` — sections to the plain structure the PDF draws (`ResumePdfDocument.tsx`);
  `ResumePdfPreview.tsx` shows that document in a dialog
- `TailorResumePage.test.tsx` — reload, live completion, failure/retry, omissions, save, and saved
  editing. `FinalResumeEditor.test.tsx` covers edit/exclude/restore and preview/save parity.
  The PDF preview is mocked; jsdom cannot draw it

## Local Rules

- Reload reads `Job.latestTailoring`; live status and completed results come from
  `aiTaskUpdated`. There is no token streaming or per-section approval flow.
- The first save is once (`saveTailoredResume`). A later visit edits `Job.resume` with
  `updateResume`. Preview shows the current included draft, including unsaved edits.
- Excluded sections keep their edits and can be restored before saving. Empty selection
  disables preview and save; sections retain their original draft order.
- Certifications have a distinct section with name, issuer, issue/expiry dates, credential
  ID/URL, and description.
