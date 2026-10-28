# AGENTS.md — features/resume-tailoring

## Purpose

Generate a complete resume draft for one job, then review, edit, exclude sections, preview,
and save it once. A finished gap analysis is included when one exists; generation does not
wait for it. Later visits open the saved resume in preview. Edit sections switches to the remembered
collapsible fields; switching views retains unsaved edits and inclusion choices.
Saved resumes download locally as PDF and editable DOCX after all edits save successfully.

## Contents

- `JobResumeTab.tsx` — `JobResumeTab` (`/jobs/:id/resume`, inside the job workspace) never starts
  paid generation: it shows the saved resume (`SavedResumeEditor.tsx`, also used by
  `/resumes/:id`), a draft in progress or failed, or an empty state with Write resume.
  `WriteJobResumePage` (`/jobs/:id/resume/write`) starts a tailor task when none exists,
  redirects to the Resume tab when a resume exists, and returns there after saving. The old
  `/jobs/:id/tailor` redirects to the Resume tab, so old links never start generation
- `FinalResumeEditor.tsx` — edit, exclude/restore, preview, and save the finished sections; each
  section starts collapsed (`resume.<jobId>.<sectionType>`). Edits and inclusion stay together
  in the editor. Preview uses included content in draft order; save also retains an excluded summary so it can be restored later
- `SavedResumeEditor.tsx` — saved sections use quiet ruled rows with section icons and remembered collapse IDs
  (`saved-resume.<resumeId>.<sectionId>`); drafts stay above collapsed panels and are keyed by section ID. Server refreshes reconcile clean fields while preserving unsaved edits.
  Both downloads capture saved content and are blocked while dirty, saving, deleting, or exporting. Confirmed
  deletion uses the resumes hook/dialog and the route's success destination.
- `resumeDownload.tsx` — render PDF and lazily load DOCX generation, sanitize saved-title
  filenames, and release browser object URLs after download handoff. `ResumePdfDocument.test.tsx`
  parses real PDF output with PDF.js; editor/page tests control the download boundary.
- `resumeDocxDocument.ts` — native Word paragraphs, headings, bullets and contact hyperlinks,
  sharing `resumePdfModel.ts` content/order with PDF. Word pagination can differ.
  `resumeDocxDocument.test.ts` inspects actual ZIP/XML output.
- `ResumeEditorActions.tsx` — shared Preview/Edit sections switch, save feedback, and document actions.
  Both editors start in preview; saving stays available in either view. Deletion sits below
  the saved workspace, separate from everyday document actions.
- `ResumeUnsavedChanges.tsx` — leave/discard dialog and native reload warning for unsaved
  resumes. New drafts are unsaved until persisted; saved editors track the submitted snapshot
  so edits made during a request remain unsaved. Successful deletion sets a ref read by the
  blocker at navigation time; do not rely on a state render before navigating after deletion.
- `SectionFields.tsx` — resume-import review fields for one section
- `sectionOrder.ts` — section names and display titles
- `tailorDraft.ts` — section JSON to and from the review-field draft
- `parseTailorTask.ts` — completed draft sections and warnings
- `tailorOperations.ts` — job query and start / save / update mutations
- `useResumeTailoring.ts` — `useResumeTailoring(jobId, { autoStart })`: load, start when needed
  (write route only), follow `aiTaskUpdated`, and retry failures
- `useTailorActions.ts` — save the reviewed resume the first time
- `useUpdateResume.ts` — `updateResume` for a resume that is already saved
- Missing or blank saved summaries show the shared `SummaryGenerationPanel` with target kind `resume`. Proposal completion never writes editor content; explicit acceptance refetches the owning job/resume query. Generation/acceptance pause for unsaved changes, save, delete, and export.
- `resumePdfModel.ts` — sections to the shared content both formats draw (`ResumePdfDocument.tsx`);
  `ResumePdfPreview.tsx` builds the same PDF inline; `ResumePdfPages.tsx` uses a lazy
  PDF.js renderer to fit every page to the available width, expose readable text to assistive
  technology, and cancel loading/drawing when unmounted. `resumeWorkspace.css` scopes the
  document desk, toolbar, and ruled editing sections
- `JobResumeTab.test.tsx` — reload, live completion, failure/retry, omissions, save, and saved
  editing. `FinalResumeEditor.test.tsx` covers edit/exclude/restore and preview/save parity.
  The PDF preview is mocked; jsdom cannot draw it

## Local Rules

- Reload reads `Job.latestTailoring`; live status and completed results come from
  `aiTaskUpdated`. There is no token streaming or per-section approval flow.
- An accepted task without a saved resume is history. A new write-route visit starts a
  fresh task; the Resume tab never does; removing a saved resume during the current visit never starts one or restores
  the old draft, even when the cached task still lacks its accepted timestamp.
- A completed task needs at least one supported, non-omitted section with object content to
  resume. Unsupported-only, omitted-only, and malformed results are history; start a fresh
  task rather than showing an empty editor. Rails uses the same rule.
- The first save is once (`saveTailoredResume`). A later visit edits `Job.resume` with
  `updateResume`. Preview shows the current included draft, including unsaved edits.
- The library Include summary preference is snapshotted when tailoring starts. Both editors expose a separate summary inclusion control, even with no summary text. Saved resumes persist that choice independently of text and never follow later library changes.
- Excluded summary text survives first save and reload. Preview/PDF/DOCX omit it through the shared output model. Other excluded sections keep their edits and can be restored before saving. Empty selection
  disables preview and save; sections retain their original draft order.
- Certifications have a distinct section with name, issuer, issue/expiry dates, credential
  ID/URL, and description.
