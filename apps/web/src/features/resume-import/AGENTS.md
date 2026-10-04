# AGENTS.md — features/resume-import

## Purpose

Import an existing resume: upload a PDF/DOCX (`parseResume`), follow the AI parse live
(`aiTaskUpdated`), let the user review and edit the result, then `importParsedResume`.

## Contents

- `ResumeUploadPage.tsx` (`/import`) — `ResumeDropzone.tsx` + `resumeFileValidation.ts`
- `ResumeImportTaskPage.tsx` (`/import/:aiTaskId`) — picks the step from the task state:
  `ParseTaskStatusCard.tsx` (connecting, parsing, failed, already imported) or
  `ParsedResumeReview.tsx` (form wired to the import mutation; on success it opens the career
  library with the added/merged counts)
- `review/` — the editable form: `ParsedResumeForm.tsx` (one `DragDropProvider` around the
  form) plus one fields component per section (tone-colored `ReviewSection` cards), and generic
  `TextField`, `StringListField` (links), `EditableList` (entry blocks), `DateRangeFields`
  - `HighlightsField.tsx` — a role's highlights; drag to reorder or into another role
  - `SkillsField.tsx` — draggable skill chips
  - `reviewDraft.ts` — the form's working copy: every entry, highlight, and skill gets a stable
    `key` (React keys and drag ids); `toParsedResume` strips the keys before import
  - `useReviewDragHandlers.ts` — reorders skills on drop; moves highlights between roles during
    the drag and restores them if it's canceled. Roles, projects, and education aren't dragged
    (the library lists them by date)
  - `reviewDraft.test.ts`, `ParsedResumeForm.test.tsx` — tests
- `parsedResume.ts` — TypeScript mirror of `services/ai/schemas/parsed_resume.py`
- `resumeImportOperations.ts` — GraphQL operations; `useParseResume`, `useAiTaskUpdates`,
  `useImportParsedResume` — hooks
- `*.test.ts(x)` — validation, parsing defaults, review form, task page states

## Local Rules

- `parsedResume.ts` must stay in sync with the Pydantic `ParsedResume` (snake_case keys, partial
  dates as "YYYY-MM" / "YYYY"). The edited object is sent back as-is (after `toParsedResume`
  removes the draft keys).
- Dragging in the review only changes the draft; matching and merging into the library still
  happen on the server at import.
- The task page must work on reload: the subscription sends the task's current state first.
