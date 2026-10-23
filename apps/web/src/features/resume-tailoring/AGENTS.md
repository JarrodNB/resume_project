# AGENTS.md — features/resume-tailoring

## Purpose

Generate a complete resume draft for one job, then review, edit, exclude sections, preview,
and save it once. A finished gap analysis is included when one exists; generation does not
wait for it. Later visits edit the saved resume. Preview opens the current draft as a large PDF.
Saved resumes download locally as PDF and editable DOCX after all edits save successfully.

## Contents

- `TailorResumePage.tsx` (`/jobs/:id/tailor`) — whole-draft loading, failure/retry, the completed
  editor, or the saved resume (`SavedResumeEditor.tsx`, also used by `/resumes/:id`)
- `FinalResumeEditor.tsx` — edit, exclude/restore, preview, and save the finished sections; each
  section starts collapsed (`resume.<jobId>.<sectionType>`). Edits and inclusion stay together
  in the editor; preview and save use the same included content in draft order
- `SavedResumeEditor.tsx` — saved sections use tone-colored cards and remembered collapse IDs
  (`saved-resume.<resumeId>.<sectionId>`); drafts stay above collapsed panels.
  Both downloads capture saved content and are blocked while dirty, saving, deleting, or exporting. Confirmed
  deletion uses the resumes hook/dialog and the route's success destination.
- `resumeDownload.tsx` — render PDF and lazily load DOCX generation, sanitize saved-title
  filenames, and release browser object URLs after download handoff. `ResumePdfDocument.test.tsx`
  parses real PDF output with a test-only reader; editor/page tests control the download boundary.
- `resumeDocxDocument.ts` — native Word paragraphs, headings, bullets and contact hyperlinks,
  sharing `resumePdfModel.ts` content/order with PDF. Word pagination can differ.
  `resumeDocxDocument.test.ts` inspects actual ZIP/XML output.
- `ResumeEditorActions.tsx` — shared wrapping Preview/Save actions and save feedback.
  New drafts lead with Review full resume, opening the existing PDF preview; save stays
  available without a review confirmation. Saved resumes keep their existing action hierarchy.
- `ResumeUnsavedChanges.tsx` — leave/discard dialog and native reload warning for unsaved
  resumes. New drafts are unsaved until persisted; saved editors track the submitted snapshot
  so edits made during a request remain unsaved. Successful deletion sets a ref read by the
  blocker at navigation time; do not rely on a state render before navigating after deletion.
- `SectionFields.tsx` — resume-import review fields for one section
- `sectionOrder.ts` — section names and display titles
- `tailorDraft.ts` — section JSON to and from the review-field draft
- `parseTailorTask.ts` — completed draft sections and warnings
- `tailorOperations.ts` — job query and start / save / update mutations
- `useResumeTailoring.ts` — load, explicitly start with a target, follow `aiTaskUpdated`, and retry failures
- `useTailorActions.ts` — save the reviewed resume the first time
- `useUpdateResume.ts` — `updateResume` for a resume that is already saved
- `resumePdfModel.ts` — sections to the shared content both formats draw (`ResumePdfDocument.tsx`);
  `ResumePdfPreview.tsx` shows that document in a dialog
- `TailorResumePage.test.tsx` — reload, live completion, failure/retry, omissions, save, and saved
  editing. `FinalResumeEditor.test.tsx` covers edit/exclude/restore and preview/save parity.
  The PDF preview is mocked; jsdom cannot draw it

## Local Rules

- Fresh tailoring shows a native 1-page/2-page choice (default 2) and explicit Tailor resume action.
  Starting is guarded while pending; generated drafts and saved editors display their fixed target.
- Reload reads `Job.latestTailoring`; live status and completed results come from
  `aiTaskUpdated`. There is no token streaming or per-section approval flow.
- An accepted task without a saved resume is history. A new tailor-page visit starts a
  setup form; only clicking Tailor resume starts fresh work. Removing a saved resume during the current visit never starts one or restores
  the old draft, even when the cached task still lacks its accepted timestamp.
- Restored drafts use their task-input target, with legacy tasks treated as 2 pages.
  Failure retries keep that target; the server resolves duplicate starts to the original draft.
- The first save is once (`saveTailoredResume`). A later visit edits `Job.resume` with
  `updateResume`. Preview shows the current included draft, including unsaved edits.
- Excluded sections keep their edits and can be restored before saving. Empty selection
  disables preview and save; sections retain their original draft order.
- Certifications have a distinct section with name, issuer, issue/expiry dates, credential
  ID/URL, and description.
