# AGENTS.md — features/resume-tailoring

## Purpose

Generate one complete constrained Markdown resume for a job, review and edit it, then save
it once. The structured career library and resume-import review fields remain independent.
Saved resumes keep their requested page target and can be edited or downloaded later.

## Contents

- `TailorResumePage.tsx` (`/jobs/:id/tailor`) — generation status, failure/retry, completed
  Markdown editor, or saved editor. Later visits restore compatible unsaved tasks.
- `FinalResumeEditor.tsx` — review current Markdown through the PDF preview and save it.
  Draft notes explain generation limits. New drafts remain unsaved until persistence succeeds.
- `SavedResumeEditor.tsx` — edit saved Markdown, preview current edits, download the last
  successfully saved snapshot, or delete with confirmation. Edits made during a save remain
  dirty after that submitted snapshot succeeds; failed saves preserve edits and export locks.
- `ResumeEditorActions.tsx` — preview/save controls and save feedback.
- `ResumeUnsavedChanges.tsx` — leave/discard dialog and native reload warning. Successful
  deletion uses a ref read by the navigation blocker before the next render.
- `resumeMarkdown.ts` — inert supported Markdown blocks shared by PDF and DOCX.
- `ResumePdfDocument.tsx`, `renderResumePdf.tsx`, `ResumePdfPreview.tsx` — fixed PDF template,
  bounded Node renderer entry, and current-draft preview dialog.
- `resumeDocxDocument.ts`, `resumeDownload.tsx` — Word output from the same Markdown blocks,
  saved-title filenames and object URL cleanup. Word pagination can differ from PDF.
- `parseTailorTask.ts` — Markdown and warnings read from task results; legacy section helpers
  remain temporarily for the old writer's retirement.
- `tailorOperations.ts`, `useResumeTailoring.ts`, `useTailorActions.ts`, `useUpdateResume.ts` —
  GraphQL operations, task restoration/subscription, first save, and later Markdown updates.
- `SectionFields.tsx`, `sectionOrder.ts`, `tailorDraft.ts` — structured resume-import review
  helpers; do not remove these without inspecting resume-import callers.
- `TailorResumePage.test.tsx` — completed/queued task restoration, live completion, failure
  retry, legacy-result rejection, first save, and saved editing. Editor tests cover preview,
  navigation warnings, save failures, concurrent edits and saved-snapshot export. Real PDF
  and DOCX tests inspect generated artifacts; jsdom page tests mock the preview boundary.

## Local Rules

- Reload reads `Job.latestTailoring`. Follow nonterminal work through `aiTaskUpdated`;
  completed and failed restored tasks do not need a subscription. Never poll.
- Accepted tasks are history. A saved resume prevents new generation or old draft restoration
  for the current visit, including cache updates during deletion.
- First save uses `saveTailoredResume`; subsequent edits use `updateResume`. Preview uses
  current Markdown. Downloads stay disabled while dirty, saving, deleting or exporting.
- Structured career-library/import data is not saved-resume Markdown.
